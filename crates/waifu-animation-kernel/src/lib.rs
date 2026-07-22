#![cfg_attr(target_arch = "wasm32", no_std)]

#[cfg(target_arch = "wasm32")]
use core::arch::wasm32;
#[cfg(target_arch = "wasm32")]
use core::panic::PanicInfo;

pub const ABI_MAJOR: u32 = 1;
pub const ABI_MINOR: u32 = 0;
pub const FEATURE_SCALAR_LOCAL_TO_MODEL: u32 = 1 << 0;
pub const FEATURE_DEBUG_SELF_TEST: u32 = 1 << 31;

pub const WA_OK: u32 = 0;
pub const WA_ERR_ABI_VERSION: u32 = 1;
pub const WA_ERR_BAD_HANDLE: u32 = 2;
pub const WA_ERR_OOB: u32 = 3;
pub const WA_ERR_INVALID_ARG: u32 = 4;
pub const WA_ERR_CAPACITY: u32 = 5;
pub const WA_ERR_UNSUPPORTED: u32 = 6;
pub const WA_ERR_INTERNAL: u32 = 7;

const NO_PARENT: i32 = -1;
const MAX_JOINTS: u32 = 1024;
#[cfg(target_arch = "wasm32")]
const WASM_PAGE_BYTES: u32 = 65_536;
const SOA_TRANSFORM_BYTES: u32 = 160;
const MAT4_BYTES: u32 = 64;
const OPTIONS_BYTES: u32 = 32;
const AVATAR_MAGIC: u32 = 0x5741_4101;
const SKELETON_MAGIC: u32 = 0x5741_5301;
const AVATAR_FLAG_DESTROYED: u32 = 1;
const SKELETON_FLAG_DESTROYED: u32 = 1;
const HANDLE_INDEX_BITS: u32 = 16;
const HANDLE_INDEX_MASK: u32 = (1 << HANDLE_INDEX_BITS) - 1;
const HANDLE_GENERATION_SHIFT: u32 = HANDLE_INDEX_BITS;
const HANDLE_GENERATION_MASK: u32 = 0x7fff;
const HANDLE_KIND_SKELETON: u32 = 1 << 31;
const MIN_GENERATION: u32 = 1;
const MAX_SKELETONS: usize = 128;
const MAX_AVATARS: usize = 128;

#[cfg(target_arch = "wasm32")]
unsafe extern "C" {
    static __heap_base: u8;
}

#[repr(C)]
#[derive(Clone, Copy)]
struct AvatarRecord {
    magic: u32,
    generation: u32,
    joint_count: u32,
    flags: u32,
    parents_offset: u32,
    reserved0: u32,
    reserved1: u32,
    reserved2: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SkeletonRecord {
    magic: u32,
    generation: u32,
    joint_count: u32,
    flags: u32,
    parents_offset: u32,
    parent_capacity_bytes: u32,
    reserved0: u32,
    reserved1: u32,
}

impl SkeletonRecord {
    const fn empty() -> Self {
        Self {
            magic: 0,
            generation: 0,
            joint_count: 0,
            flags: 0,
            parents_offset: 0,
            parent_capacity_bytes: 0,
            reserved0: 0,
            reserved1: 0,
        }
    }
}

impl AvatarRecord {
    const fn empty() -> Self {
        Self {
            magic: 0,
            generation: 0,
            joint_count: 0,
            flags: 0,
            parents_offset: 0,
            reserved0: 0,
            reserved1: 0,
            reserved2: 0,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LocalToModelOptions {
    pub parent_indices_offset: u32,
    pub parent_indices_count: u32,
    pub parent_indices_capacity_bytes: u32,
    pub from: i32,
    pub to: i32,
    pub flags: u32,
    pub root_matrix_offset: u32,
    pub root_matrix_capacity_bytes: u32,
}

impl LocalToModelOptions {
    pub const FLAG_FROM_EXCLUDED: u32 = 1 << 0;
    pub const FLAG_HAS_ROOT: u32 = 1 << 1;

    pub const fn full(
        parent_indices_offset: u32,
        joint_count: u32,
        parent_indices_capacity_bytes: u32,
    ) -> Self {
        Self {
            parent_indices_offset,
            parent_indices_count: joint_count,
            parent_indices_capacity_bytes,
            from: NO_PARENT,
            to: -1,
            flags: 0,
            root_matrix_offset: 0,
            root_matrix_capacity_bytes: 0,
        }
    }
}

static mut MEMORY_EPOCH: u32 = 0;
static mut BUMP_PTR: u32 = 0;
static mut SKELETONS: [SkeletonRecord; MAX_SKELETONS] = [SkeletonRecord::empty(); MAX_SKELETONS];
static mut AVATARS: [AvatarRecord; MAX_AVATARS] = [AvatarRecord::empty(); MAX_AVATARS];

#[unsafe(no_mangle)]
pub extern "C" fn wa_version_major() -> u32 {
    ABI_MAJOR
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_version_minor() -> u32 {
    ABI_MINOR
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_feature_flags() -> u32 {
    FEATURE_SCALAR_LOCAL_TO_MODEL | FEATURE_DEBUG_SELF_TEST
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_memory_epoch() -> u32 {
    unsafe { MEMORY_EPOCH }
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_refresh_views_required(observed_epoch: u32) -> u32 {
    u32::from(unsafe { MEMORY_EPOCH } != observed_epoch)
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_heap_base() -> u32 {
    heap_base()
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_alloc(size_bytes: u32, alignment: u32, out_offset_ptr: u32) -> u32 {
    let alignment = if alignment == 0 { 16 } else { alignment };
    if !alignment.is_power_of_two() || alignment > 65_536 || !is_aligned(out_offset_ptr, 4) {
        return WA_ERR_INVALID_ARG;
    }
    if out_offset_ptr == 0 || !memory_range_valid(out_offset_ptr, 4) {
        return WA_ERR_OOB;
    }
    let size = match align_up(size_bytes, alignment) {
        Some(value) => value,
        None => return WA_ERR_CAPACITY,
    };
    let offset = match alloc_bytes(size, alignment) {
        Some(value) => value,
        None => return WA_ERR_CAPACITY,
    };
    unsafe { write_u32(out_offset_ptr, offset) };
    WA_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_create_skeleton(
    parent_indices_offset: u32,
    joint_count: u32,
    parent_indices_capacity_bytes: u32,
    out_handle_ptr: u32,
) -> u32 {
    if joint_count == 0
        || joint_count > MAX_JOINTS
        || parent_indices_capacity_bytes < joint_count * 4
        || !is_aligned(parent_indices_offset, 4)
        || out_handle_ptr == 0
        || !is_aligned(out_handle_ptr, 4)
    {
        return WA_ERR_INVALID_ARG;
    }
    if !memory_range_valid(out_handle_ptr, 4)
        || !memory_range_valid(parent_indices_offset, joint_count * 4)
    {
        return WA_ERR_OOB;
    }
    let parent_validation = validate_parent_table(parent_indices_offset, joint_count);
    if parent_validation != WA_OK {
        return parent_validation;
    }

    let Some(slot) = find_free_skeleton_slot() else {
        return WA_ERR_CAPACITY;
    };
    unsafe {
        let records = core::ptr::addr_of_mut!(SKELETONS) as *mut SkeletonRecord;
        let record = records.add(slot);
        let previous_generation = (*record).generation;
        let generation = next_generation(previous_generation);
        *record = SkeletonRecord {
            magic: SKELETON_MAGIC,
            generation,
            joint_count,
            flags: 0,
            parents_offset: parent_indices_offset,
            parent_capacity_bytes: parent_indices_capacity_bytes,
            reserved0: 0,
            reserved1: 0,
        };
        write_u32(
            out_handle_ptr,
            make_handle(slot, generation, HANDLE_KIND_SKELETON),
        );
    }
    WA_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_create_avatar(
    skeleton_handle: u32,
    joint_count: u32,
    flags: u32,
    out_handle_ptr: u32,
) -> u32 {
    if joint_count == 0
        || joint_count > MAX_JOINTS
        || flags != 0
        || out_handle_ptr == 0
        || !is_aligned(out_handle_ptr, 4)
    {
        return WA_ERR_INVALID_ARG;
    }
    if !memory_range_valid(out_handle_ptr, 4) {
        return WA_ERR_OOB;
    }

    let Some(skeleton) = skeleton_record(skeleton_handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    if skeleton.joint_count != joint_count {
        return WA_ERR_INVALID_ARG;
    }

    let Some(slot) = find_free_avatar_slot() else {
        return WA_ERR_CAPACITY;
    };

    unsafe {
        let records = core::ptr::addr_of_mut!(AVATARS) as *mut AvatarRecord;
        let record = records.add(slot);
        let previous_generation = (*record).generation;
        let generation = next_generation(previous_generation);
        *record = AvatarRecord {
            magic: AVATAR_MAGIC,
            generation,
            joint_count,
            flags: 0,
            parents_offset: skeleton.parents_offset,
            reserved0: 0,
            reserved1: 0,
            reserved2: 0,
        };
        write_u32(out_handle_ptr, make_handle(slot, generation, 0));
    }
    WA_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_destroy_handle(handle: u32) -> u32 {
    let Some(slot) = handle_slot(handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    if handle & HANDLE_KIND_SKELETON != 0 {
        unsafe {
            let records = core::ptr::addr_of_mut!(SKELETONS) as *mut SkeletonRecord;
            let record = records.add(slot);
            if !skeleton_matches_handle(*record, handle) {
                return WA_ERR_BAD_HANDLE;
            }
            (*record).flags |= SKELETON_FLAG_DESTROYED;
            (*record).generation = next_generation((*record).generation);
            (*record).magic = 0;
        }
        return WA_OK;
    }

    unsafe {
        let records = core::ptr::addr_of_mut!(AVATARS) as *mut AvatarRecord;
        let record = records.add(slot);
        if !record_matches_handle(*record, handle) {
            return WA_ERR_BAD_HANDLE;
        }
        (*record).flags |= AVATAR_FLAG_DESTROYED;
        (*record).generation = next_generation((*record).generation);
        (*record).magic = 0;
    }
    WA_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_local_to_model(
    avatar_handle: u32,
    local_pose_offset: u32,
    model_pose_offset: u32,
    joint_count: u32,
    options_ptr: u32,
) -> u32 {
    let Some(record) = avatar_record(avatar_handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    if joint_count == 0 || joint_count > record.joint_count || joint_count > MAX_JOINTS {
        return WA_ERR_INVALID_ARG;
    }
    if !is_aligned(local_pose_offset, 16) || !is_aligned(model_pose_offset, 16) {
        return WA_ERR_INVALID_ARG;
    }
    let group_count = group_count(joint_count);
    let local_bytes = match group_count.checked_mul(SOA_TRANSFORM_BYTES) {
        Some(value) => value,
        None => return WA_ERR_CAPACITY,
    };
    let model_bytes = match joint_count.checked_mul(MAT4_BYTES) {
        Some(value) => value,
        None => return WA_ERR_CAPACITY,
    };
    if !memory_range_valid(local_pose_offset, local_bytes)
        || !memory_range_valid(model_pose_offset, model_bytes)
    {
        return WA_ERR_OOB;
    }

    let mut options = if options_ptr == 0 {
        LocalToModelOptions::full(record.parents_offset, joint_count, record.joint_count * 4)
    } else {
        if !is_aligned(options_ptr, 4) || !memory_range_valid(options_ptr, OPTIONS_BYTES) {
            return WA_ERR_OOB;
        }
        read_options(options_ptr)
    };
    if options.to < 0 {
        options.to = joint_count as i32 - 1;
    }
    let validation = validate_options(&options, joint_count);
    if validation != WA_OK {
        return validation;
    }
    if !memory_range_valid(options.parent_indices_offset, joint_count * 4) {
        return WA_ERR_OOB;
    }
    if options.flags & LocalToModelOptions::FLAG_HAS_ROOT != 0
        && !memory_range_valid(options.root_matrix_offset, MAT4_BYTES)
    {
        return WA_ERR_OOB;
    }

    local_to_model_unchecked(
        record,
        local_pose_offset,
        model_pose_offset,
        joint_count,
        &options,
    )
}

#[cfg(target_arch = "wasm32")]
#[unsafe(no_mangle)]
pub extern "C" fn wa_force_memory_growth_for_test(min_extra_pages: u32) -> u32 {
    let pages = if min_extra_pages == 0 {
        1
    } else {
        min_extra_pages
    } as usize;
    let before = wasm32::memory_size(0);
    if wasm32::memory_grow(0, pages) == usize::MAX {
        return WA_ERR_CAPACITY;
    }
    let after = wasm32::memory_size(0);
    if after > before {
        unsafe { MEMORY_EPOCH = MEMORY_EPOCH.wrapping_add(1) };
    }
    WA_OK
}

#[cfg(not(target_arch = "wasm32"))]
#[unsafe(no_mangle)]
pub extern "C" fn wa_force_memory_growth_for_test(_min_extra_pages: u32) -> u32 {
    WA_ERR_UNSUPPORTED
}

#[cfg(target_arch = "wasm32")]
#[unsafe(no_mangle)]
pub extern "C" fn wa_reset_for_test() -> u32 {
    unsafe {
        let records = core::ptr::addr_of_mut!(AVATARS) as *mut AvatarRecord;
        for index in 0..MAX_AVATARS {
            let record = records.add(index);
            *record = AvatarRecord::empty();
        }
        let skeletons = core::ptr::addr_of_mut!(SKELETONS) as *mut SkeletonRecord;
        for index in 0..MAX_SKELETONS {
            let record = skeletons.add(index);
            *record = SkeletonRecord::empty();
        }
        MEMORY_EPOCH = MEMORY_EPOCH.wrapping_add(1);
        BUMP_PTR = heap_base();
    }
    WA_OK
}

#[cfg(not(target_arch = "wasm32"))]
#[unsafe(no_mangle)]
pub extern "C" fn wa_reset_for_test() -> u32 {
    WA_ERR_UNSUPPORTED
}

fn local_to_model_unchecked(
    record: AvatarRecord,
    local_pose_offset: u32,
    model_pose_offset: u32,
    joint_count: u32,
    options: &LocalToModelOptions,
) -> u32 {
    let from = options.from;
    let to = options.to;
    let from_excluded = options.flags & LocalToModelOptions::FLAG_FROM_EXCLUDED != 0;
    let has_root = options.flags & LocalToModelOptions::FLAG_HAS_ROOT != 0;
    let mut selected = [0u8; MAX_JOINTS as usize];
    let end = to as u32;

    for joint in 0..joint_count {
        let parent = unsafe { read_i32(options.parent_indices_offset + joint * 4) };
        if !valid_parent(parent, joint) {
            return WA_ERR_INVALID_ARG;
        }

        let parent_selected = if parent >= 0 {
            selected[parent as usize] == 1
        } else {
            false
        };
        if from == NO_PARENT || joint as i32 == from || (parent >= 0 && parent_selected) {
            selected[joint as usize] = 1;
        }

        if selected[joint as usize] != 1 || joint > end || (from_excluded && joint as i32 == from) {
            continue;
        }

        let local = compose_local_matrix(local_pose_offset, joint);
        let out_offset = model_pose_offset + joint * MAT4_BYTES;
        if parent == NO_PARENT {
            if has_root {
                multiply_to_offset(options.root_matrix_offset, local.as_ptr(), out_offset);
            } else {
                unsafe { write_mat4(out_offset, &local) };
            }
            continue;
        }

        let parent_model_offset = model_pose_offset + parent as u32 * MAT4_BYTES;
        if !memory_range_valid(parent_model_offset, MAT4_BYTES) {
            return WA_ERR_INTERNAL;
        }
        multiply_to_offset(parent_model_offset, local.as_ptr(), out_offset);
    }

    let _ = record;
    WA_OK
}

fn validate_options(options: &LocalToModelOptions, joint_count: u32) -> u32 {
    if options.parent_indices_count < joint_count {
        return WA_ERR_CAPACITY;
    }
    if options.parent_indices_capacity_bytes < joint_count * 4 {
        return WA_ERR_CAPACITY;
    }
    if !is_aligned(options.parent_indices_offset, 4) {
        return WA_ERR_INVALID_ARG;
    }
    if options.flags
        & !(LocalToModelOptions::FLAG_FROM_EXCLUDED | LocalToModelOptions::FLAG_HAS_ROOT)
        != 0
    {
        return WA_ERR_INVALID_ARG;
    }
    if options.from != NO_PARENT && (options.from < 0 || options.from as u32 >= joint_count) {
        return WA_ERR_INVALID_ARG;
    }
    if options.to < 0 || options.to as u32 >= joint_count {
        return WA_ERR_INVALID_ARG;
    }
    if options.flags & LocalToModelOptions::FLAG_HAS_ROOT != 0
        && (!is_aligned(options.root_matrix_offset, 16)
            || options.root_matrix_capacity_bytes < MAT4_BYTES)
    {
        return WA_ERR_INVALID_ARG;
    }
    WA_OK
}

fn compose_local_matrix(local_pose_offset: u32, joint: u32) -> [f32; 16] {
    let group = joint >> 2;
    let lane = joint & 3;
    let base = local_pose_offset + group * SOA_TRANSFORM_BYTES;
    let tx = read_soa_f32(base, 0, lane, 0.0);
    let ty = read_soa_f32(base, 1, lane, 0.0);
    let tz = read_soa_f32(base, 2, lane, 0.0);
    let qx = read_soa_f32(base, 3, lane, 0.0);
    let qy = read_soa_f32(base, 4, lane, 0.0);
    let qz = read_soa_f32(base, 5, lane, 0.0);
    let qw = read_soa_f32(base, 6, lane, 1.0);
    let sx = read_soa_f32(base, 7, lane, 1.0);
    let sy = read_soa_f32(base, 8, lane, 1.0);
    let sz = read_soa_f32(base, 9, lane, 1.0);
    compose_mat4(tx, ty, tz, qx, qy, qz, qw, sx, sy, sz)
}

#[allow(clippy::too_many_arguments)]
fn compose_mat4(
    tx: f32,
    ty: f32,
    tz: f32,
    qx: f32,
    qy: f32,
    qz: f32,
    qw: f32,
    sx: f32,
    sy: f32,
    sz: f32,
) -> [f32; 16] {
    let (x, y, z, w) = normalize_quat(qx, qy, qz, qw);
    let sx = sanitize_f32(sx, 1.0);
    let sy = sanitize_f32(sy, 1.0);
    let sz = sanitize_f32(sz, 1.0);
    let x2 = x + x;
    let y2 = y + y;
    let z2 = z + z;
    let xx = x * x2;
    let xy = x * y2;
    let xz = x * z2;
    let yy = y * y2;
    let yz = y * z2;
    let zz = z * z2;
    let wx = w * x2;
    let wy = w * y2;
    let wz = w * z2;
    [
        (1.0 - (yy + zz)) * sx,
        (xy + wz) * sx,
        (xz - wy) * sx,
        0.0,
        (xy - wz) * sy,
        (1.0 - (xx + zz)) * sy,
        (yz + wx) * sy,
        0.0,
        (xz + wy) * sz,
        (yz - wx) * sz,
        (1.0 - (xx + yy)) * sz,
        0.0,
        sanitize_f32(tx, 0.0),
        sanitize_f32(ty, 0.0),
        sanitize_f32(tz, 0.0),
        1.0,
    ]
}

fn normalize_quat(x: f32, y: f32, z: f32, w: f32) -> (f32, f32, f32, f32) {
    if !(x.is_finite() && y.is_finite() && z.is_finite() && w.is_finite()) {
        return (0.0, 0.0, 0.0, 1.0);
    }
    let length = libm_hypot4(x, y, z, w);
    if !length.is_finite() || length <= 1.0e-8 {
        return (0.0, 0.0, 0.0, 1.0);
    }
    let inv = 1.0 / length;
    (x * inv, y * inv, z * inv, w * inv)
}

fn libm_hypot4(x: f32, y: f32, z: f32, w: f32) -> f32 {
    libm::sqrtf(x * x + y * y + z * z + w * w)
}

fn sanitize_f32(value: f32, fallback: f32) -> f32 {
    if value.is_finite() { value } else { fallback }
}

fn read_soa_f32(base: u32, field: u32, lane: u32, fallback: f32) -> f32 {
    let offset = base + (field * 4 + lane) * 4;
    sanitize_f32(unsafe { read_f32(offset) }, fallback)
}

fn multiply_to_offset(a_offset: u32, b_ptr: *const f32, out_offset: u32) {
    for col in 0..4u32 {
        for row in 0..4u32 {
            let a0 = unsafe { read_f32(a_offset + row * 4) };
            let a1 = unsafe { read_f32(a_offset + (4 + row) * 4) };
            let a2 = unsafe { read_f32(a_offset + (8 + row) * 4) };
            let a3 = unsafe { read_f32(a_offset + (12 + row) * 4) };
            let b0 = unsafe { *b_ptr.add((col * 4) as usize) };
            let b1 = unsafe { *b_ptr.add((col * 4 + 1) as usize) };
            let b2 = unsafe { *b_ptr.add((col * 4 + 2) as usize) };
            let b3 = unsafe { *b_ptr.add((col * 4 + 3) as usize) };
            let value = a0 * b0 + a1 * b1 + a2 * b2 + a3 * b3;
            unsafe { write_f32(out_offset + (col * 4 + row) * 4, value) };
        }
    }
}

fn valid_parent(parent: i32, joint: u32) -> bool {
    parent == NO_PARENT || (parent >= 0 && (parent as u32) < joint)
}

fn validate_parent_table(parent_indices_offset: u32, joint_count: u32) -> u32 {
    for joint in 0..joint_count {
        let parent = unsafe { read_i32(parent_indices_offset + joint * 4) };
        if !valid_parent(parent, joint) {
            return WA_ERR_INVALID_ARG;
        }
    }
    WA_OK
}

fn skeleton_record(handle: u32) -> Option<SkeletonRecord> {
    if handle & HANDLE_KIND_SKELETON == 0 {
        return None;
    }
    let slot = handle_slot(handle)?;
    unsafe {
        let record = *((core::ptr::addr_of!(SKELETONS) as *const SkeletonRecord).add(slot));
        if skeleton_matches_handle(record, handle) {
            Some(record)
        } else {
            None
        }
    }
}

fn skeleton_matches_handle(record: SkeletonRecord, handle: u32) -> bool {
    record.magic == SKELETON_MAGIC
        && record.flags & SKELETON_FLAG_DESTROYED == 0
        && record.generation == handle_generation(handle)
        && handle & HANDLE_KIND_SKELETON != 0
}

fn avatar_record(handle: u32) -> Option<AvatarRecord> {
    if handle & HANDLE_KIND_SKELETON != 0 {
        return None;
    }
    let slot = handle_slot(handle)?;
    unsafe {
        let record = *((core::ptr::addr_of!(AVATARS) as *const AvatarRecord).add(slot));
        if record_matches_handle(record, handle) {
            Some(record)
        } else {
            None
        }
    }
}

fn record_matches_handle(record: AvatarRecord, handle: u32) -> bool {
    record.magic == AVATAR_MAGIC
        && record.flags & AVATAR_FLAG_DESTROYED == 0
        && record.generation == handle_generation(handle)
        && handle & HANDLE_KIND_SKELETON == 0
}

fn find_free_skeleton_slot() -> Option<usize> {
    unsafe {
        let records = core::ptr::addr_of!(SKELETONS) as *const SkeletonRecord;
        for slot in 0..MAX_SKELETONS {
            let record = *records.add(slot);
            if record.magic != SKELETON_MAGIC || record.flags & SKELETON_FLAG_DESTROYED != 0 {
                return Some(slot);
            }
        }
    }
    None
}

fn find_free_avatar_slot() -> Option<usize> {
    unsafe {
        let records = core::ptr::addr_of!(AVATARS) as *const AvatarRecord;
        for slot in 0..MAX_AVATARS {
            let record = *records.add(slot);
            if record.magic != AVATAR_MAGIC || record.flags & AVATAR_FLAG_DESTROYED != 0 {
                return Some(slot);
            }
        }
    }
    None
}

fn make_handle(slot: usize, generation: u32, kind: u32) -> u32 {
    kind | ((generation & HANDLE_GENERATION_MASK) << HANDLE_GENERATION_SHIFT)
        | ((slot as u32 + 1) & HANDLE_INDEX_MASK)
}

fn handle_slot(handle: u32) -> Option<usize> {
    let index = handle & HANDLE_INDEX_MASK;
    if index == 0 {
        return None;
    }
    let slot = (index - 1) as usize;
    if slot < MAX_AVATARS { Some(slot) } else { None }
}

fn handle_generation(handle: u32) -> u32 {
    (handle >> HANDLE_GENERATION_SHIFT) & HANDLE_GENERATION_MASK
}

fn next_generation(previous: u32) -> u32 {
    let next = (previous.wrapping_add(1)) & HANDLE_GENERATION_MASK;
    if next < MIN_GENERATION {
        MIN_GENERATION
    } else {
        next
    }
}

fn read_options(offset: u32) -> LocalToModelOptions {
    LocalToModelOptions {
        parent_indices_offset: unsafe { read_u32(offset) },
        parent_indices_count: unsafe { read_u32(offset + 4) },
        parent_indices_capacity_bytes: unsafe { read_u32(offset + 8) },
        from: unsafe { read_i32(offset + 12) },
        to: unsafe { read_i32(offset + 16) },
        flags: unsafe { read_u32(offset + 20) },
        root_matrix_offset: unsafe { read_u32(offset + 24) },
        root_matrix_capacity_bytes: unsafe { read_u32(offset + 28) },
    }
}

fn alloc_bytes(size_bytes: u32, alignment: u32) -> Option<u32> {
    let mut bump = unsafe { BUMP_PTR };
    if bump == 0 {
        bump = heap_base();
    }
    let aligned = align_up(bump, alignment)?;
    let end = aligned.checked_add(size_bytes)?;
    if !ensure_memory(end) {
        return None;
    }
    unsafe { BUMP_PTR = end };
    Some(aligned)
}

#[cfg(target_arch = "wasm32")]
fn ensure_memory(required_end: u32) -> bool {
    let current_pages = wasm32::memory_size(0) as u32;
    let current_bytes = current_pages.saturating_mul(WASM_PAGE_BYTES);
    if required_end <= current_bytes {
        return true;
    }
    let needed_bytes = match required_end.checked_sub(current_bytes) {
        Some(value) => value,
        None => return false,
    };
    let needed_pages = needed_bytes.div_ceil(WASM_PAGE_BYTES);
    let before = current_pages;
    if wasm32::memory_grow(0, needed_pages as usize) == usize::MAX {
        return false;
    }
    let after = wasm32::memory_size(0) as u32;
    if after > before {
        unsafe { MEMORY_EPOCH = MEMORY_EPOCH.wrapping_add(1) };
    }
    true
}

#[cfg(not(target_arch = "wasm32"))]
fn ensure_memory(_required_end: u32) -> bool {
    true
}

#[cfg(target_arch = "wasm32")]
fn heap_base() -> u32 {
    (&raw const __heap_base) as usize as u32
}

#[cfg(not(target_arch = "wasm32"))]
fn heap_base() -> u32 {
    1024 * 1024
}

#[cfg(target_arch = "wasm32")]
fn memory_len() -> u32 {
    (wasm32::memory_size(0) as u32).saturating_mul(WASM_PAGE_BYTES)
}

#[cfg(not(target_arch = "wasm32"))]
fn memory_len() -> u32 {
    u32::MAX
}

fn memory_range_valid(offset: u32, size_bytes: u32) -> bool {
    let Some(end) = offset.checked_add(size_bytes) else {
        return false;
    };
    end <= memory_len()
}

fn is_aligned(offset: u32, alignment: u32) -> bool {
    alignment != 0 && offset & (alignment - 1) == 0
}

fn align_up(value: u32, alignment: u32) -> Option<u32> {
    let mask = alignment.checked_sub(1)?;
    value.checked_add(mask).map(|value| value & !mask)
}

fn group_count(joint_count: u32) -> u32 {
    joint_count.div_ceil(4)
}

unsafe fn read_u32(offset: u32) -> u32 {
    unsafe { (offset as usize as *const u32).read_unaligned() }
}

unsafe fn read_i32(offset: u32) -> i32 {
    unsafe { (offset as usize as *const i32).read_unaligned() }
}

unsafe fn read_f32(offset: u32) -> f32 {
    unsafe { (offset as usize as *const f32).read_unaligned() }
}

unsafe fn write_u32(offset: u32, value: u32) {
    unsafe { (offset as usize as *mut u32).write_unaligned(value) };
}

unsafe fn write_f32(offset: u32, value: f32) {
    unsafe { (offset as usize as *mut f32).write_unaligned(value) };
}

unsafe fn write_mat4(offset: u32, matrix: &[f32; 16]) {
    for (index, value) in matrix.iter().enumerate() {
        unsafe { write_f32(offset + index as u32 * 4, *value) };
    }
}

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_identity_is_column_major_identity() {
        let matrix = compose_mat4(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0);
        assert_eq!(
            matrix,
            [
                1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0
            ]
        );
    }

    #[test]
    fn invalid_quaternion_normalizes_to_identity() {
        let matrix = compose_mat4(1.0, 2.0, 3.0, f32::NAN, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0);
        assert_eq!(matrix[0], 1.0);
        assert_eq!(matrix[5], 1.0);
        assert_eq!(matrix[10], 1.0);
        assert_eq!(matrix[12], 1.0);
        assert_eq!(matrix[13], 2.0);
        assert_eq!(matrix[14], 3.0);
    }

    #[test]
    fn parent_validation_requires_parent_before_child() {
        assert!(valid_parent(NO_PARENT, 0));
        assert!(valid_parent(0, 1));
        assert!(!valid_parent(1, 1));
        assert!(!valid_parent(2, 1));
        assert!(!valid_parent(-2, 1));
    }
}
