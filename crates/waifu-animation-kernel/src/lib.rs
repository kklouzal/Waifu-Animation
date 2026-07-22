#![cfg_attr(target_arch = "wasm32", no_std)]

#[cfg(target_arch = "wasm32")]
use core::arch::wasm32;
#[cfg(target_arch = "wasm32")]
use core::panic::PanicInfo;

pub const ABI_MAJOR: u32 = 1;
pub const ABI_MINOR: u32 = 6;
pub const FEATURE_SCALAR_LOCAL_TO_MODEL: u32 = 1 << 0;
pub const FEATURE_SCALAR_POSE_BLEND: u32 = 1 << 1;
pub const FEATURE_SCALAR_ADDITIVE: u32 = 1 << 2;
pub const FEATURE_SCALAR_JOINT_MASKS: u32 = 1 << 3;
pub const FEATURE_RETAINED_PACKED_SAMPLING: u32 = 1 << 4;
pub const FEATURE_RETAINED_SKINNING: u32 = 1 << 5;
pub const FEATURE_RETAINED_PROCEDURAL_CORRECTIONS: u32 = 1 << 6;
pub const FEATURE_SIMD_MATRIX_JOBS: u32 = 1 << 16;
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
const BLEND_LAYER_BYTES: u32 = 24;
const PACKED_TRACK_BYTES: u32 = 64;
const F32_BYTES: u32 = 4;
const TRANSFORM_COMPONENTS: usize = 10;
const EPSILON: f32 = 1.0e-8;
const AVATAR_MAGIC: u32 = 0x5741_4101;
const SKELETON_MAGIC: u32 = 0x5741_5301;
const CLIP_MAGIC: u32 = 0x5741_4301;
const SAMPLING_CONTEXT_MAGIC: u32 = 0x5741_5801;
const SKINNING_JOB_MAGIC: u32 = 0x5741_4b01;
const AVATAR_FLAG_DESTROYED: u32 = 1;
const SKELETON_FLAG_DESTROYED: u32 = 1;
const HANDLE_INDEX_BITS: u32 = 16;
const HANDLE_INDEX_MASK: u32 = (1 << HANDLE_INDEX_BITS) - 1;
const HANDLE_GENERATION_SHIFT: u32 = HANDLE_INDEX_BITS;
const HANDLE_GENERATION_MASK: u32 = 0x1fff;
const HANDLE_KIND_MASK: u32 = 3 << 30;
const HANDLE_KIND_AVATAR: u32 = 0;
const HANDLE_KIND_CLIP: u32 = 1 << 30;
const HANDLE_KIND_SKELETON: u32 = 1 << 31;
const HANDLE_KIND_SAMPLING_CONTEXT: u32 = 3 << 30;
const HANDLE_SKINNING_TAG: u32 = 1 << 29;
const MIN_GENERATION: u32 = 1;
const MAX_SKELETONS: usize = 128;
const MAX_AVATARS: usize = 128;
const MAX_CLIPS: usize = 128;
const MAX_SAMPLING_CONTEXTS: usize = 128;
const MAX_SKINNING_JOBS: usize = 128;

const SKIN_FLAG_HAS_REMAPS: u32 = 1 << 0;
const SKIN_WEIGHT_EXPLICIT: u32 = 1;
const SKIN_DESC_BYTES: u32 = 128;
const SKIN_DESC_NORMALS: u32 = 1 << 0;
const SKIN_DESC_TANGENTS: u32 = 1 << 1;

const CORRECTION_DESC_BYTES: u32 = 192;
const CORRECTION_KIND_TWO_BONE: u32 = 1;
const CORRECTION_KIND_AIM: u32 = 2;
const CORRECTION_KIND_FOOT: u32 = 3;
const CORRECTION_FLAG_HAS_POLE: u32 = 1 << 0;
const CORRECTION_FLAG_HAS_MID_AXIS: u32 = 1 << 1;
const CORRECTION_FLAG_HAS_UP: u32 = 1 << 2;
const CORRECTION_FLAG_HAS_OFFSET: u32 = 1 << 3;
const CORRECTION_FLAG_APPLY_ORIENTATION: u32 = 1 << 4;

const SAMPLE_FLAG_LOOP: u32 = 1 << 0;
const SAMPLE_FLAG_RESET_CACHE: u32 = 1 << 1;

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

#[repr(C)]
#[derive(Clone, Copy)]
struct ClipRecord {
    magic: u32,
    generation: u32,
    track_count: u32,
    flags: u32,
    tracks_offset: u32,
    tracks_capacity_bytes: u32,
    times_offset: u32,
    times_count: u32,
    times_capacity_bytes: u32,
    values_offset: u32,
    values_count: u32,
    values_capacity_bytes: u32,
    duration_bits: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SamplingContextRecord {
    magic: u32,
    generation: u32,
    clip_handle: u32,
    flags: u32,
    lower_keys_offset: u32,
    lower_keys_capacity_bytes: u32,
    last_time_bits: u32,
    sample_count: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SkinningJobRecord {
    magic: u32,
    generation: u32,
    palette_count: u32,
    vertex_count: u32,
    influences: u32,
    weight_mode: u32,
    index_stride: u32,
    weight_stride: u32,
    inverse_bind_offset: u32,
    inverse_bind_capacity_bytes: u32,
    remap_offset: u32,
    remap_capacity_bytes: u32,
    indices_offset: u32,
    indices_capacity_bytes: u32,
    weights_offset: u32,
    weights_capacity_bytes: u32,
    flags: u32,
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

impl ClipRecord {
    const fn empty() -> Self {
        Self {
            magic: 0,
            generation: 0,
            track_count: 0,
            flags: 0,
            tracks_offset: 0,
            tracks_capacity_bytes: 0,
            times_offset: 0,
            times_count: 0,
            times_capacity_bytes: 0,
            values_offset: 0,
            values_count: 0,
            values_capacity_bytes: 0,
            duration_bits: 0,
        }
    }
}

impl SamplingContextRecord {
    const fn empty() -> Self {
        Self {
            magic: 0,
            generation: 0,
            clip_handle: 0,
            flags: 0,
            lower_keys_offset: 0,
            lower_keys_capacity_bytes: 0,
            last_time_bits: 0,
            sample_count: 0,
        }
    }
}

impl SkinningJobRecord {
    const fn empty() -> Self {
        Self {
            magic: 0,
            generation: 0,
            palette_count: 0,
            vertex_count: 0,
            influences: 0,
            weight_mode: 0,
            index_stride: 0,
            weight_stride: 0,
            inverse_bind_offset: 0,
            inverse_bind_capacity_bytes: 0,
            remap_offset: 0,
            remap_capacity_bytes: 0,
            indices_offset: 0,
            indices_capacity_bytes: 0,
            weights_offset: 0,
            weights_capacity_bytes: 0,
            flags: 0,
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
static mut SIMD_EXECUTION_COUNT: u32 = 0;
static mut BUMP_PTR: u32 = 0;
static mut SKELETONS: [SkeletonRecord; MAX_SKELETONS] = [SkeletonRecord::empty(); MAX_SKELETONS];
static mut AVATARS: [AvatarRecord; MAX_AVATARS] = [AvatarRecord::empty(); MAX_AVATARS];
static mut CLIPS: [ClipRecord; MAX_CLIPS] = [ClipRecord::empty(); MAX_CLIPS];
static mut SAMPLING_CONTEXTS: [SamplingContextRecord; MAX_SAMPLING_CONTEXTS] =
    [SamplingContextRecord::empty(); MAX_SAMPLING_CONTEXTS];
static mut SKINNING_JOBS: [SkinningJobRecord; MAX_SKINNING_JOBS] =
    [SkinningJobRecord::empty(); MAX_SKINNING_JOBS];

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
    let features = FEATURE_SCALAR_LOCAL_TO_MODEL
        | FEATURE_SCALAR_POSE_BLEND
        | FEATURE_SCALAR_ADDITIVE
        | FEATURE_SCALAR_JOINT_MASKS
        | FEATURE_RETAINED_PACKED_SAMPLING
        | FEATURE_RETAINED_SKINNING
        | FEATURE_RETAINED_PROCEDURAL_CORRECTIONS
        | FEATURE_DEBUG_SELF_TEST;
    #[cfg(feature = "simd")]
    {
        features | FEATURE_SIMD_MATRIX_JOBS
    }
    #[cfg(not(feature = "simd"))]
    {
        features
    }
}

/// 0 = portable scalar-WASM, 1 = wasm32 SIMD128 matrix jobs.
#[unsafe(no_mangle)]
pub extern "C" fn wa_execution_mode() -> u32 {
    if cfg!(feature = "simd") { 1 } else { 0 }
}

/// Monotonic proof counter incremented only by SIMD matrix implementations.
#[unsafe(no_mangle)]
pub extern "C" fn wa_simd_execution_count() -> u32 {
    unsafe { SIMD_EXECUTION_COUNT }
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
pub extern "C" fn wa_create_packed_clip(
    tracks_offset: u32,
    track_count: u32,
    tracks_capacity_bytes: u32,
    times_offset: u32,
    times_count: u32,
    times_capacity_bytes: u32,
    values_offset: u32,
    values_count: u32,
    values_capacity_bytes: u32,
    duration: f32,
    flags: u32,
    out_handle_ptr: u32,
) -> u32 {
    if track_count == 0
        || track_count > MAX_JOINTS
        || !duration.is_finite()
        || duration <= 0.0
        || flags != 0
        || !is_aligned(tracks_offset, 4)
        || !is_aligned(times_offset, 4)
        || !is_aligned(values_offset, 4)
        || !is_aligned(out_handle_ptr, 4)
        || out_handle_ptr == 0
    {
        return WA_ERR_INVALID_ARG;
    }
    let Some(track_bytes) = track_count.checked_mul(PACKED_TRACK_BYTES) else {
        return WA_ERR_CAPACITY;
    };
    let Some(time_bytes) = times_count.checked_mul(F32_BYTES) else {
        return WA_ERR_CAPACITY;
    };
    let Some(value_bytes) = values_count.checked_mul(F32_BYTES) else {
        return WA_ERR_CAPACITY;
    };
    if tracks_capacity_bytes < track_bytes
        || times_capacity_bytes < time_bytes
        || values_capacity_bytes < value_bytes
    {
        return WA_ERR_CAPACITY;
    }
    if !memory_range_valid(tracks_offset, track_bytes)
        || !memory_range_valid(times_offset, time_bytes)
        || !memory_range_valid(values_offset, value_bytes)
        || !memory_range_valid(out_handle_ptr, 4)
    {
        return WA_ERR_OOB;
    }
    for track in 0..track_count {
        let descriptor = tracks_offset + track * PACKED_TRACK_BYTES;
        let property = unsafe { read_u32(descriptor + 4) };
        let stride = unsafe { read_u32(descriptor + 8) };
        let key_count = unsafe { read_u32(descriptor + 12) };
        let time_offset = unsafe { read_u32(descriptor + 16) };
        let value_offset = unsafe { read_u32(descriptor + 20) };
        let track_flags = unsafe { read_u32(descriptor + 24) };
        if property > 2
            || stride != if property == 1 { 4 } else { 3 }
            || key_count == 0
            || track_flags & !3 != 0
            || time_offset
                .checked_add(key_count)
                .is_none_or(|end| end > times_count)
            || value_offset
                .checked_add(key_count.saturating_mul(stride))
                .is_none_or(|end| end > values_count)
        {
            return WA_ERR_INVALID_ARG;
        }
        let mut previous = f32::NEG_INFINITY;
        for key in 0..key_count {
            let time = unsafe { read_f32(times_offset + (time_offset + key) * F32_BYTES) };
            if !time.is_finite() || time < previous {
                return WA_ERR_INVALID_ARG;
            }
            previous = time;
        }
    }
    let Some(slot) = find_free_clip_slot() else {
        return WA_ERR_CAPACITY;
    };
    unsafe {
        let records = core::ptr::addr_of_mut!(CLIPS) as *mut ClipRecord;
        let record = records.add(slot);
        let generation = next_generation((*record).generation);
        *record = ClipRecord {
            magic: CLIP_MAGIC,
            generation,
            track_count,
            flags: 0,
            tracks_offset,
            tracks_capacity_bytes,
            times_offset,
            times_count,
            times_capacity_bytes,
            values_offset,
            values_count,
            values_capacity_bytes,
            duration_bits: duration.to_bits(),
        };
        write_u32(
            out_handle_ptr,
            make_handle(slot, generation, HANDLE_KIND_CLIP),
        );
    }
    WA_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_create_sampling_context(
    clip_handle: u32,
    lower_keys_offset: u32,
    lower_keys_capacity_bytes: u32,
    out_handle_ptr: u32,
) -> u32 {
    let Some(clip) = clip_record(clip_handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    let required = match clip.track_count.checked_mul(F32_BYTES) {
        Some(value) => value,
        None => return WA_ERR_CAPACITY,
    };
    if !is_aligned(lower_keys_offset, 4) || !is_aligned(out_handle_ptr, 4) || out_handle_ptr == 0 {
        return WA_ERR_INVALID_ARG;
    }
    if lower_keys_capacity_bytes < required {
        return WA_ERR_CAPACITY;
    }
    if !memory_range_valid(lower_keys_offset, required) || !memory_range_valid(out_handle_ptr, 4) {
        return WA_ERR_OOB;
    }
    let Some(slot) = find_free_sampling_context_slot() else {
        return WA_ERR_CAPACITY;
    };
    for track in 0..clip.track_count {
        unsafe { write_u32(lower_keys_offset + track * 4, u32::MAX) };
    }
    unsafe {
        let records = core::ptr::addr_of_mut!(SAMPLING_CONTEXTS) as *mut SamplingContextRecord;
        let record = records.add(slot);
        let generation = next_generation((*record).generation);
        *record = SamplingContextRecord {
            magic: SAMPLING_CONTEXT_MAGIC,
            generation,
            clip_handle,
            flags: 0,
            lower_keys_offset,
            lower_keys_capacity_bytes,
            last_time_bits: 0,
            sample_count: 0,
        };
        write_u32(
            out_handle_ptr,
            make_handle(slot, generation, HANDLE_KIND_SAMPLING_CONTEXT),
        );
    }
    WA_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_reset_sampling_context(context_handle: u32) -> u32 {
    let Some(context) = sampling_context_record_mut(context_handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    let Some(clip) = clip_record(context.clip_handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    for track in 0..clip.track_count {
        unsafe { write_u32(context.lower_keys_offset + track * 4, u32::MAX) };
    }
    context.flags = 0;
    context.last_time_bits = 0;
    WA_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_sample_packed_clip(
    avatar_handle: u32,
    clip_handle: u32,
    context_handle: u32,
    rest_pose_offset: u32,
    rest_pose_capacity_bytes: u32,
    output_pose_offset: u32,
    output_pose_capacity_bytes: u32,
    joint_count: u32,
    time: f32,
    flags: u32,
) -> u32 {
    sample_packed_clip_impl(
        avatar_handle,
        clip_handle,
        context_handle,
        rest_pose_offset,
        rest_pose_capacity_bytes,
        output_pose_offset,
        output_pose_capacity_bytes,
        joint_count,
        time,
        flags,
        false,
    )
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_sample_packed_clip_joint(
    avatar_handle: u32,
    clip_handle: u32,
    context_handle: u32,
    rest_pose_offset: u32,
    rest_pose_capacity_bytes: u32,
    output_pose_offset: u32,
    output_pose_capacity_bytes: u32,
    joint_count: u32,
    time: f32,
    flags: u32,
    joint: u32,
    out_transform_offset: u32,
) -> u32 {
    let status = sample_packed_clip_impl(
        avatar_handle,
        clip_handle,
        context_handle,
        rest_pose_offset,
        rest_pose_capacity_bytes,
        output_pose_offset,
        output_pose_capacity_bytes,
        joint_count,
        time,
        flags,
        false,
    );
    if status != WA_OK {
        return status;
    }
    if joint >= joint_count
        || !is_aligned(out_transform_offset, 4)
        || !memory_range_valid(out_transform_offset, 40)
    {
        return WA_ERR_INVALID_ARG;
    }
    let transform = read_transform_repaired(output_pose_offset, joint);
    for (index, value) in transform.iter().enumerate() {
        unsafe { write_f32(out_transform_offset + index as u32 * 4, *value) };
    }
    WA_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_sample_packed_clip_ratio(
    avatar_handle: u32,
    clip_handle: u32,
    context_handle: u32,
    rest_pose_offset: u32,
    rest_pose_capacity_bytes: u32,
    output_pose_offset: u32,
    output_pose_capacity_bytes: u32,
    joint_count: u32,
    ratio: f32,
    flags: u32,
) -> u32 {
    sample_packed_clip_impl(
        avatar_handle,
        clip_handle,
        context_handle,
        rest_pose_offset,
        rest_pose_capacity_bytes,
        output_pose_offset,
        output_pose_capacity_bytes,
        joint_count,
        ratio,
        flags,
        true,
    )
}

#[allow(clippy::too_many_arguments)]
fn sample_packed_clip_impl(
    avatar_handle: u32,
    clip_handle: u32,
    context_handle: u32,
    rest_pose_offset: u32,
    rest_pose_capacity_bytes: u32,
    output_pose_offset: u32,
    output_pose_capacity_bytes: u32,
    joint_count: u32,
    input: f32,
    flags: u32,
    ratio_input: bool,
) -> u32 {
    let Some(avatar) = avatar_record(avatar_handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    let Some(clip) = clip_record(clip_handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    let Some(context) = sampling_context_record_mut(context_handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    if context.clip_handle != clip_handle {
        return WA_ERR_BAD_HANDLE;
    }
    if flags & !(SAMPLE_FLAG_LOOP | SAMPLE_FLAG_RESET_CACHE) != 0 {
        return WA_ERR_INVALID_ARG;
    }
    let pose_bytes = match validate_pose_job(
        avatar,
        joint_count,
        output_pose_offset,
        output_pose_capacity_bytes,
    ) {
        Ok(value) => value,
        Err(status) => return status,
    };
    let rest_status = validate_pose_range(rest_pose_offset, rest_pose_capacity_bytes, pose_bytes);
    if rest_status != WA_OK {
        return rest_status;
    }
    let duration = f32::from_bits(clip.duration_bits);
    let mut time = if input.is_finite() { input } else { 0.0 };
    if ratio_input {
        time = time.clamp(0.0, 1.0) * duration;
    } else if flags & SAMPLE_FLAG_LOOP != 0 {
        time %= duration;
        if time < 0.0 {
            time += duration;
        }
    } else {
        time = time.clamp(0.0, duration);
    }
    let had_sample = context.flags & 1 != 0;
    let coherent_forward = had_sample
        && flags & SAMPLE_FLAG_RESET_CACHE == 0
        && time >= f32::from_bits(context.last_time_bits);
    if flags & SAMPLE_FLAG_RESET_CACHE != 0 {
        for track in 0..clip.track_count {
            unsafe { write_u32(context.lower_keys_offset + track * 4, u32::MAX) };
        }
    }
    // Validate every avatar-specific controller target before touching output,
    // preserving the ABI's no-partial-write rule for malformed descriptors.
    for track_index in 0..clip.track_count {
        let descriptor = clip.tracks_offset + track_index * PACKED_TRACK_BYTES;
        if unsafe { read_u32(descriptor) } >= joint_count {
            return WA_ERR_INVALID_ARG;
        }
    }
    for joint in 0..joint_count {
        write_transform(
            output_pose_offset,
            joint,
            read_transform_repaired(rest_pose_offset, joint),
        );
    }
    write_padded_identity_lanes(output_pose_offset, joint_count);

    for track_index in 0..clip.track_count {
        let descriptor = clip.tracks_offset + track_index * PACKED_TRACK_BYTES;
        let joint = unsafe { read_u32(descriptor) };
        let property = unsafe { read_u32(descriptor + 4) };
        let stride = unsafe { read_u32(descriptor + 8) };
        let key_count = unsafe { read_u32(descriptor + 12) };
        let time_offset = unsafe { read_u32(descriptor + 16) };
        let value_offset = unsafe { read_u32(descriptor + 20) };
        let track_flags = unsafe { read_u32(descriptor + 24) };
        let cache_offset = context.lower_keys_offset + track_index * 4;
        let first_time = unsafe { read_f32(clip.times_offset + time_offset * 4) };
        let last_key = key_count - 1;
        let last_time = unsafe { read_f32(clip.times_offset + (time_offset + last_key) * 4) };
        let (lower, upper) = if time <= first_time {
            unsafe { write_u32(cache_offset, 0) };
            (0, 0)
        } else if time >= last_time {
            unsafe { write_u32(cache_offset, last_key.saturating_sub(1)) };
            (last_key, last_key)
        } else {
            let last_lower = key_count - 2;
            let cached = unsafe { read_u32(cache_offset) };
            let lower = if coherent_forward
                && cached <= last_lower
                && time >= unsafe { read_f32(clip.times_offset + (time_offset + cached) * 4) }
            {
                let mut value = cached;
                while value < last_lower
                    && time > unsafe { read_f32(clip.times_offset + (time_offset + value + 1) * 4) }
                {
                    value += 1;
                }
                value
            } else {
                find_packed_lower_key(clip, time_offset, key_count, time)
            };
            unsafe { write_u32(cache_offset, lower) };
            (lower, lower + 1)
        };
        let mut sampled = read_packed_sample(
            clip,
            value_offset,
            stride,
            lower,
            property,
            descriptor,
            track_flags,
        );
        if lower != upper {
            let start = unsafe { read_f32(clip.times_offset + (time_offset + lower) * 4) };
            let end = unsafe { read_f32(clip.times_offset + (time_offset + upper) * 4) };
            let amount = if end > start {
                ((time - start) / (end - start)).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let other = read_packed_sample(
                clip,
                value_offset,
                stride,
                upper,
                property,
                descriptor,
                track_flags,
            );
            if property == 1 {
                let rotation = slerp_quat(
                    [sampled[0], sampled[1], sampled[2], sampled[3]],
                    [other[0], other[1], other[2], other[3]],
                    amount,
                );
                sampled[..4].copy_from_slice(&rotation);
            } else {
                for component in 0..3 {
                    sampled[component] += (other[component] - sampled[component]) * amount;
                }
            }
        }
        let mut transform = read_transform_raw(output_pose_offset, joint);
        if property == 0 {
            transform[..3].copy_from_slice(&sampled[..3]);
        } else if property == 2 {
            transform[7..10].copy_from_slice(&sampled[..3]);
        } else {
            let target_rest = [transform[3], transform[4], transform[5], transform[6]];
            let mut rotation = [sampled[0], sampled[1], sampled[2], sampled[3]];
            if track_flags & 2 != 0 {
                rotation = multiply_quat(rotation, target_rest);
            } else if track_flags & 1 != 0 {
                let source_rest = read_descriptor_quat(descriptor + 28, [0.0, 0.0, 0.0, 1.0]);
                rotation = multiply_quat(
                    multiply_quat(rotation, invert_quat(source_rest)),
                    target_rest,
                );
            }
            transform[3..7].copy_from_slice(&rotation);
        }
        write_transform(output_pose_offset, joint, normalize_transform(transform));
    }
    context.flags |= 1;
    context.last_time_bits = time.to_bits();
    context.sample_count = context.sample_count.wrapping_add(1);
    WA_OK
}

fn find_packed_lower_key(clip: ClipRecord, time_offset: u32, key_count: u32, time: f32) -> u32 {
    let mut low = 1;
    let mut high = key_count - 1;
    while low < high {
        let mid = (low + high) >> 1;
        let value = unsafe { read_f32(clip.times_offset + (time_offset + mid) * 4) };
        if value < time {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    low - 1
}

fn read_descriptor_quat(offset: u32, fallback: [f32; 4]) -> [f32; 4] {
    normalize_quat_with_fallback(
        [
            unsafe { read_f32(offset) },
            unsafe { read_f32(offset + 4) },
            unsafe { read_f32(offset + 8) },
            unsafe { read_f32(offset + 12) },
        ],
        fallback,
    )
}

fn read_packed_sample(
    clip: ClipRecord,
    value_offset: u32,
    stride: u32,
    key: u32,
    property: u32,
    descriptor: u32,
    track_flags: u32,
) -> [f32; 4] {
    let base = clip.values_offset + (value_offset + key * stride) * 4;
    if property == 1 {
        let fallback = if track_flags & 2 != 0 {
            [0.0, 0.0, 0.0, 1.0]
        } else if track_flags & 1 != 0 {
            read_descriptor_quat(descriptor + 28, [0.0, 0.0, 0.0, 1.0])
        } else {
            [0.0, 0.0, 0.0, 1.0]
        };
        normalize_quat_with_fallback(
            [
                unsafe { read_f32(base) },
                unsafe { read_f32(base + 4) },
                unsafe { read_f32(base + 8) },
                unsafe { read_f32(base + 12) },
            ],
            fallback,
        )
    } else {
        let fallback = if property == 2 { 1.0 } else { 0.0 };
        [
            sanitize_f32(unsafe { read_f32(base) }, fallback),
            sanitize_f32(unsafe { read_f32(base + 4) }, fallback),
            sanitize_f32(unsafe { read_f32(base + 8) }, fallback),
            0.0,
        ]
    }
}

fn normalize_quat_with_fallback(value: [f32; 4], fallback: [f32; 4]) -> [f32; 4] {
    let length = libm_hypot4(value[0], value[1], value[2], value[3]);
    if value.iter().all(|component| component.is_finite()) && length.is_finite() && length > EPSILON
    {
        [
            value[0] / length,
            value[1] / length,
            value[2] / length,
            value[3] / length,
        ]
    } else {
        normalize_quat_array(fallback)
    }
}

fn slerp_quat(a: [f32; 4], mut b: [f32; 4], amount: f32) -> [f32; 4] {
    let mut cosine = dot_quat(a, b);
    if cosine < 0.0 {
        for value in &mut b {
            *value = -*value;
        }
        cosine = -cosine;
    }
    if cosine > 0.9995 {
        return normalize_quat_array([
            a[0] + (b[0] - a[0]) * amount,
            a[1] + (b[1] - a[1]) * amount,
            a[2] + (b[2] - a[2]) * amount,
            a[3] + (b[3] - a[3]) * amount,
        ]);
    }
    let theta0 = libm::acosf(cosine.clamp(-1.0, 1.0));
    let theta = theta0 * amount;
    let sin_theta = libm::sinf(theta);
    let sin_theta0 = libm::sinf(theta0);
    let s0 = libm::cosf(theta) - cosine * sin_theta / sin_theta0;
    let s1 = sin_theta / sin_theta0;
    normalize_quat_array([
        a[0] * s0 + b[0] * s1,
        a[1] * s0 + b[1] * s1,
        a[2] * s0 + b[2] * s1,
        a[3] * s0 + b[3] * s1,
    ])
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_create_skinning_job(
    inverse_bind_offset: u32,
    palette_count: u32,
    inverse_bind_capacity_bytes: u32,
    remap_offset: u32,
    remap_capacity_bytes: u32,
    indices_offset: u32,
    indices_capacity_bytes: u32,
    weights_offset: u32,
    weights_capacity_bytes: u32,
    vertex_count: u32,
    influences: u32,
    index_stride: u32,
    weight_stride: u32,
    weight_mode: u32,
    flags: u32,
    out_handle_ptr: u32,
) -> u32 {
    if palette_count == 0
        || palette_count > 65_536
        || influences == 0
        || influences > 256
        || index_stride < influences
        || weight_mode > SKIN_WEIGHT_EXPLICIT
        || flags & !SKIN_FLAG_HAS_REMAPS != 0
        || !is_aligned(inverse_bind_offset, 4)
        || !is_aligned(indices_offset, 4)
        || !is_aligned(out_handle_ptr, 4)
        || out_handle_ptr == 0
    {
        return WA_ERR_INVALID_ARG;
    }
    let stored_weights = if weight_mode == SKIN_WEIGHT_EXPLICIT {
        influences
    } else {
        influences - 1
    };
    if weight_stride < stored_weights
        || (stored_weights > 0 && !is_aligned(weights_offset, 4))
        || (flags & SKIN_FLAG_HAS_REMAPS != 0 && !is_aligned(remap_offset, 4))
    {
        return WA_ERR_INVALID_ARG;
    }
    let Some(inverse_bytes) = palette_count.checked_mul(MAT4_BYTES) else {
        return WA_ERR_CAPACITY;
    };
    let Some(index_values) = required_strided_values(vertex_count, index_stride, influences) else {
        return WA_ERR_CAPACITY;
    };
    let Some(weight_values) = required_strided_values(vertex_count, weight_stride, stored_weights)
    else {
        return WA_ERR_CAPACITY;
    };
    if inverse_bind_capacity_bytes < inverse_bytes
        || indices_capacity_bytes < index_values.saturating_mul(F32_BYTES)
        || weights_capacity_bytes < weight_values.saturating_mul(F32_BYTES)
        || (flags & SKIN_FLAG_HAS_REMAPS != 0
            && remap_capacity_bytes < palette_count.saturating_mul(F32_BYTES))
    {
        return WA_ERR_CAPACITY;
    }
    if !memory_range_valid(out_handle_ptr, 4)
        || !memory_range_valid(inverse_bind_offset, inverse_bytes)
        || !memory_range_valid(indices_offset, index_values.saturating_mul(F32_BYTES))
        || (weight_values > 0
            && !memory_range_valid(weights_offset, weight_values.saturating_mul(F32_BYTES)))
        || (flags & SKIN_FLAG_HAS_REMAPS != 0
            && !memory_range_valid(remap_offset, palette_count.saturating_mul(F32_BYTES)))
    {
        return WA_ERR_OOB;
    }
    let Some(slot) = find_free_skinning_job_slot() else {
        return WA_ERR_CAPACITY;
    };
    unsafe {
        let records = core::ptr::addr_of_mut!(SKINNING_JOBS) as *mut SkinningJobRecord;
        let record = records.add(slot);
        let generation = next_generation((*record).generation);
        *record = SkinningJobRecord {
            magic: SKINNING_JOB_MAGIC,
            generation,
            palette_count,
            vertex_count,
            influences,
            weight_mode,
            index_stride,
            weight_stride,
            inverse_bind_offset,
            inverse_bind_capacity_bytes,
            remap_offset,
            remap_capacity_bytes,
            indices_offset,
            indices_capacity_bytes,
            weights_offset,
            weights_capacity_bytes,
            flags,
        };
        write_u32(
            out_handle_ptr,
            make_handle(slot, generation, HANDLE_KIND_CLIP | HANDLE_SKINNING_TAG),
        );
    }
    WA_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_build_skinning_palette(
    job_handle: u32,
    model_matrices_offset: u32,
    model_matrices_count: u32,
    model_matrices_capacity_bytes: u32,
    palette_offset: u32,
    palette_capacity_bytes: u32,
) -> u32 {
    let Some(job) = skinning_job_record(job_handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    if model_matrices_count == 0
        || !is_aligned(model_matrices_offset, 4)
        || !is_aligned(palette_offset, 4)
    {
        return WA_ERR_INVALID_ARG;
    }
    let Some(model_bytes) = model_matrices_count.checked_mul(MAT4_BYTES) else {
        return WA_ERR_CAPACITY;
    };
    let Some(palette_bytes) = job.palette_count.checked_mul(MAT4_BYTES) else {
        return WA_ERR_CAPACITY;
    };
    if model_matrices_capacity_bytes < model_bytes || palette_capacity_bytes < palette_bytes {
        return WA_ERR_CAPACITY;
    }
    if !memory_range_valid(model_matrices_offset, model_bytes)
        || !memory_range_valid(palette_offset, palette_bytes)
    {
        return WA_ERR_OOB;
    }
    if ranges_overlap(
        model_matrices_offset,
        model_bytes,
        palette_offset,
        palette_bytes,
    ) {
        return WA_ERR_INVALID_ARG;
    }
    for index in 0..job.palette_count {
        let model_index = if job.flags & SKIN_FLAG_HAS_REMAPS != 0 {
            sanitize_index(
                unsafe { read_f32(job.remap_offset + index * F32_BYTES) },
                model_matrices_count,
            )
        } else if index < model_matrices_count {
            index
        } else {
            0
        };
        let model = read_mat4_repaired(model_matrices_offset + model_index * MAT4_BYTES, None);
        let inverse = read_mat4_repaired(job.inverse_bind_offset + index * MAT4_BYTES, None);
        let result = multiply_mat4_arrays(&model, &inverse);
        unsafe { write_mat4(palette_offset + index * MAT4_BYTES, &result) };
    }
    WA_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_skin_vertices(job_handle: u32, descriptor_offset: u32) -> u32 {
    let Some(job) = skinning_job_record(job_handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    if !is_aligned(descriptor_offset, 4) || !memory_range_valid(descriptor_offset, SKIN_DESC_BYTES)
    {
        return WA_ERR_OOB;
    }
    let read = |field: u32| unsafe { read_u32(descriptor_offset + field) };
    let palette_offset = read(0);
    let palette_capacity = read(4);
    let vector_palette_offset = read(8);
    let vector_palette_capacity = read(12);
    let position_offset = read(16);
    let position_capacity = read(20);
    let normal_offset = read(24);
    let normal_capacity = read(28);
    let tangent_offset = read(32);
    let tangent_capacity = read(36);
    let out_position_offset = read(40);
    let out_position_capacity = read(44);
    let out_normal_offset = read(48);
    let out_normal_capacity = read(52);
    let out_tangent_offset = read(56);
    let out_tangent_capacity = read(60);
    let position_component_offset = read(64);
    let position_stride = read(68);
    let normal_component_offset = read(72);
    let normal_stride = read(76);
    let tangent_component_offset = read(80);
    let tangent_stride = read(84);
    let out_position_component_offset = read(88);
    let out_position_stride = read(92);
    let out_normal_component_offset = read(96);
    let out_normal_stride = read(100);
    let out_tangent_component_offset = read(104);
    let out_tangent_stride = read(108);
    let flags = read(112);

    if flags & !(SKIN_DESC_NORMALS | SKIN_DESC_TANGENTS) != 0
        || flags & SKIN_DESC_TANGENTS != 0 && flags & SKIN_DESC_NORMALS == 0
        || position_stride < 3
        || out_position_stride < 3
        || flags & SKIN_DESC_NORMALS != 0 && (normal_stride < 3 || out_normal_stride < 3)
        || flags & SKIN_DESC_TANGENTS != 0 && (tangent_stride < 3 || out_tangent_stride < 3)
    {
        return WA_ERR_INVALID_ARG;
    }
    let palette_bytes = job.palette_count.saturating_mul(MAT4_BYTES);
    if palette_capacity < palette_bytes
        || (vector_palette_offset != 0 && vector_palette_capacity < palette_bytes)
    {
        return WA_ERR_CAPACITY;
    }
    let Some(position_bytes) = required_strided_bytes(
        job.vertex_count,
        position_component_offset,
        position_stride,
        3,
    ) else {
        return WA_ERR_CAPACITY;
    };
    let Some(out_position_bytes) = required_strided_bytes(
        job.vertex_count,
        out_position_component_offset,
        out_position_stride,
        3,
    ) else {
        return WA_ERR_CAPACITY;
    };
    let normal_bytes = if flags & SKIN_DESC_NORMALS != 0 {
        let Some(value) =
            required_strided_bytes(job.vertex_count, normal_component_offset, normal_stride, 3)
        else {
            return WA_ERR_CAPACITY;
        };
        value
    } else {
        0
    };
    let out_normal_bytes = if flags & SKIN_DESC_NORMALS != 0 {
        let Some(value) = required_strided_bytes(
            job.vertex_count,
            out_normal_component_offset,
            out_normal_stride,
            3,
        ) else {
            return WA_ERR_CAPACITY;
        };
        value
    } else {
        0
    };
    let tangent_bytes = if flags & SKIN_DESC_TANGENTS != 0 {
        let Some(value) = required_strided_bytes(
            job.vertex_count,
            tangent_component_offset,
            tangent_stride,
            3,
        ) else {
            return WA_ERR_CAPACITY;
        };
        value
    } else {
        0
    };
    let out_tangent_bytes = if flags & SKIN_DESC_TANGENTS != 0 {
        let Some(value) = required_strided_bytes(
            job.vertex_count,
            out_tangent_component_offset,
            out_tangent_stride,
            3,
        ) else {
            return WA_ERR_CAPACITY;
        };
        value
    } else {
        0
    };
    let buffers = [
        (palette_offset, palette_bytes, palette_capacity),
        (position_offset, position_bytes, position_capacity),
        (
            out_position_offset,
            out_position_bytes,
            out_position_capacity,
        ),
        (normal_offset, normal_bytes, normal_capacity),
        (out_normal_offset, out_normal_bytes, out_normal_capacity),
        (tangent_offset, tangent_bytes, tangent_capacity),
        (out_tangent_offset, out_tangent_bytes, out_tangent_capacity),
    ];
    for (offset, bytes, capacity) in buffers {
        if bytes > 0
            && (!is_aligned(offset, 4) || capacity < bytes || !memory_range_valid(offset, bytes))
        {
            return if capacity < bytes {
                WA_ERR_CAPACITY
            } else {
                WA_ERR_OOB
            };
        }
    }
    if vector_palette_offset != 0
        && (!is_aligned(vector_palette_offset, 4)
            || !memory_range_valid(vector_palette_offset, palette_bytes))
    {
        return WA_ERR_OOB;
    }
    let inputs = [
        (palette_offset, palette_bytes),
        (
            vector_palette_offset,
            if vector_palette_offset == 0 {
                0
            } else {
                palette_bytes
            },
        ),
        (position_offset, position_bytes),
        (normal_offset, normal_bytes),
        (tangent_offset, tangent_bytes),
    ];
    let outputs = [
        (out_position_offset, out_position_bytes),
        (out_normal_offset, out_normal_bytes),
        (out_tangent_offset, out_tangent_bytes),
    ];
    for (out_offset, out_bytes) in outputs {
        if out_bytes == 0 {
            continue;
        }
        for (input_offset, input_bytes) in inputs {
            if input_bytes > 0 && ranges_overlap(out_offset, out_bytes, input_offset, input_bytes) {
                return WA_ERR_INVALID_ARG;
            }
        }
        for (other_offset, other_bytes) in outputs {
            if other_bytes > 0
                && other_offset != out_offset
                && ranges_overlap(out_offset, out_bytes, other_offset, other_bytes)
            {
                return WA_ERR_INVALID_ARG;
            }
        }
    }

    for vertex in 0..job.vertex_count {
        let position = read_vec3_repaired(
            position_offset + (position_component_offset + vertex * position_stride) * F32_BYTES,
        );
        let normal = if flags & SKIN_DESC_NORMALS != 0 {
            read_vec3_repaired(
                normal_offset + (normal_component_offset + vertex * normal_stride) * F32_BYTES,
            )
        } else {
            [0.0; 3]
        };
        let tangent = if flags & SKIN_DESC_TANGENTS != 0 {
            read_vec3_repaired(
                tangent_offset + (tangent_component_offset + vertex * tangent_stride) * F32_BYTES,
            )
        } else {
            [0.0; 3]
        };
        let mut out_position = [0.0; 3];
        let mut out_normal = [0.0; 3];
        let mut out_tangent = [0.0; 3];
        let explicit_sum = if job.weight_mode == SKIN_WEIGHT_EXPLICIT {
            explicit_weight_sum(job, vertex)
        } else {
            0.0
        };
        let mut restored_sum = 0.0;
        for influence in 0..job.influences {
            let index_slot = vertex * job.index_stride + influence;
            let joint = unsafe { read_u32(job.indices_offset + index_slot * F32_BYTES) };
            let joint = if joint < job.palette_count { joint } else { 0 };
            let weight =
                resolve_skin_weight(job, vertex, influence, explicit_sum, &mut restored_sum);
            if weight == 0.0 {
                continue;
            }
            let matrix = read_mat4_repaired(palette_offset + joint * MAT4_BYTES, None);
            accumulate_point(&mut out_position, &matrix, position, weight);
            if flags & SKIN_DESC_NORMALS != 0 {
                let vector_matrix = if vector_palette_offset == 0 {
                    matrix
                } else {
                    read_mat4_repaired(vector_palette_offset + joint * MAT4_BYTES, Some(&matrix))
                };
                accumulate_vector(&mut out_normal, &vector_matrix, normal, weight);
                if flags & SKIN_DESC_TANGENTS != 0 {
                    accumulate_vector(&mut out_tangent, &vector_matrix, tangent, weight);
                }
            }
        }
        write_vec3_repaired(
            out_position_offset
                + (out_position_component_offset + vertex * out_position_stride) * F32_BYTES,
            out_position,
        );
        if flags & SKIN_DESC_NORMALS != 0 {
            write_vec3_repaired(
                out_normal_offset
                    + (out_normal_component_offset + vertex * out_normal_stride) * F32_BYTES,
                out_normal,
            );
        }
        if flags & SKIN_DESC_TANGENTS != 0 {
            write_vec3_repaired(
                out_tangent_offset
                    + (out_tangent_component_offset + vertex * out_tangent_stride) * F32_BYTES,
                out_tangent,
            );
        }
    }
    WA_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_destroy_handle(handle: u32) -> u32 {
    let Some(slot) = handle_slot(handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    let kind = handle & HANDLE_KIND_MASK;
    if kind == HANDLE_KIND_SKELETON {
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

    if kind == HANDLE_KIND_CLIP {
        unsafe {
            if handle & HANDLE_SKINNING_TAG != 0 {
                let records = core::ptr::addr_of_mut!(SKINNING_JOBS) as *mut SkinningJobRecord;
                let record = records.add(slot);
                if !skinning_job_matches_handle(*record, handle) {
                    return WA_ERR_BAD_HANDLE;
                }
                (*record).magic = 0;
                (*record).generation = next_generation((*record).generation);
                return WA_OK;
            }
            let records = core::ptr::addr_of_mut!(CLIPS) as *mut ClipRecord;
            let record = records.add(slot);
            if !clip_matches_handle(*record, handle) {
                return WA_ERR_BAD_HANDLE;
            }
            (*record).magic = 0;
            (*record).generation = next_generation((*record).generation);
        }
        return WA_OK;
    }

    if kind == HANDLE_KIND_SAMPLING_CONTEXT {
        unsafe {
            let records = core::ptr::addr_of_mut!(SAMPLING_CONTEXTS) as *mut SamplingContextRecord;
            let record = records.add(slot);
            if !sampling_context_matches_handle(*record, handle) {
                return WA_ERR_BAD_HANDLE;
            }
            (*record).magic = 0;
            (*record).generation = next_generation((*record).generation);
        }
        return WA_OK;
    }

    if kind != HANDLE_KIND_AVATAR {
        return WA_ERR_BAD_HANDLE;
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

#[unsafe(no_mangle)]
pub extern "C" fn wa_apply_procedural_corrections(
    avatar_handle: u32,
    local_pose_offset: u32,
    local_pose_capacity_bytes: u32,
    model_pose_offset: u32,
    model_pose_capacity_bytes: u32,
    joint_count: u32,
    descriptors_offset: u32,
    descriptor_count: u32,
    descriptors_capacity_bytes: u32,
    options_ptr: u32,
) -> u32 {
    let Some(record) = avatar_record(avatar_handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    let pose_bytes = match group_count(joint_count).checked_mul(SOA_TRANSFORM_BYTES) {
        Some(value) => value,
        None => return WA_ERR_CAPACITY,
    };
    let model_bytes = match joint_count.checked_mul(MAT4_BYTES) {
        Some(value) => value,
        None => return WA_ERR_CAPACITY,
    };
    if joint_count == 0 || joint_count > record.joint_count || joint_count > MAX_JOINTS {
        return WA_ERR_INVALID_ARG;
    }
    if !is_aligned(local_pose_offset, 16)
        || !is_aligned(model_pose_offset, 16)
        || !is_aligned(descriptors_offset, 4)
    {
        return WA_ERR_INVALID_ARG;
    }
    if local_pose_capacity_bytes < pose_bytes || model_pose_capacity_bytes < model_bytes {
        return WA_ERR_CAPACITY;
    }
    if !memory_range_valid(local_pose_offset, pose_bytes)
        || !memory_range_valid(model_pose_offset, model_bytes)
    {
        return WA_ERR_OOB;
    }
    let descriptor_bytes = match descriptor_count.checked_mul(CORRECTION_DESC_BYTES) {
        Some(value) => value,
        None => return WA_ERR_CAPACITY,
    };
    if descriptor_count > MAX_JOINTS || descriptors_capacity_bytes < descriptor_bytes {
        return WA_ERR_CAPACITY;
    }
    if !memory_range_valid(descriptors_offset, descriptor_bytes) {
        return WA_ERR_OOB;
    }
    if options_ptr == 0
        || !is_aligned(options_ptr, 4)
        || !memory_range_valid(options_ptr, OPTIONS_BYTES)
    {
        return WA_ERR_OOB;
    }
    let mut options = read_options(options_ptr);
    if options.to < 0 {
        options.to = joint_count as i32 - 1;
    }
    let validation = validate_options(&options, joint_count);
    if validation != WA_OK {
        return validation;
    }

    for index in 0..descriptor_count {
        let descriptor = descriptors_offset + index * CORRECTION_DESC_BYTES;
        let kind = unsafe { read_u32(descriptor) };
        let flags = unsafe { read_u32(descriptor + 4) };
        let joint0 = unsafe { read_i32(descriptor + 8) };
        let joint1 = unsafe { read_i32(descriptor + 12) };
        let joint2 = unsafe { read_i32(descriptor + 16) };
        if joint0 < 0 || joint0 as u32 >= joint_count {
            return WA_ERR_INVALID_ARG;
        }
        let from = match kind {
            CORRECTION_KIND_TWO_BONE | CORRECTION_KIND_FOOT => {
                if joint1 < 0
                    || joint2 < 0
                    || joint1 as u32 >= joint_count
                    || joint2 as u32 >= joint_count
                {
                    return WA_ERR_INVALID_ARG;
                }
                if !is_descendant(options.parent_indices_offset, joint1 as u32, joint0 as u32)
                    || !is_descendant(options.parent_indices_offset, joint2 as u32, joint1 as u32)
                {
                    return WA_ERR_INVALID_ARG;
                }
                apply_two_bone_descriptor(local_pose_offset, model_pose_offset, descriptor, flags);
                if kind == CORRECTION_KIND_FOOT && flags & CORRECTION_FLAG_APPLY_ORIENTATION != 0 {
                    // Ankle aim observes the leg-corrected model frame, matching TS two-stage order.
                    let mut leg_refresh = options;
                    leg_refresh.from = joint0;
                    leg_refresh.flags &= !LocalToModelOptions::FLAG_FROM_EXCLUDED;
                    let status = local_to_model_unchecked(
                        record,
                        local_pose_offset,
                        model_pose_offset,
                        joint_count,
                        &leg_refresh,
                    );
                    if status != WA_OK {
                        return status;
                    }
                    apply_aim_descriptor(
                        local_pose_offset,
                        model_pose_offset,
                        descriptor,
                        joint2 as u32,
                        flags,
                        104,
                    );
                }
                joint0
            }
            CORRECTION_KIND_AIM => {
                apply_aim_descriptor(
                    local_pose_offset,
                    model_pose_offset,
                    descriptor,
                    joint0 as u32,
                    flags,
                    24,
                );
                joint0
            }
            _ => return WA_ERR_INVALID_ARG,
        };
        let mut refresh = options;
        refresh.from = from;
        refresh.flags &= !LocalToModelOptions::FLAG_FROM_EXCLUDED;
        let status = local_to_model_unchecked(
            record,
            local_pose_offset,
            model_pose_offset,
            joint_count,
            &refresh,
        );
        if status != WA_OK {
            return status;
        }
    }
    WA_OK
}

fn is_descendant(parents_offset: u32, mut joint: u32, ancestor: u32) -> bool {
    loop {
        if joint == ancestor {
            return true;
        }
        let parent = unsafe { read_i32(parents_offset + joint * 4) };
        if parent < 0 {
            return false;
        }
        joint = parent as u32;
    }
}

fn descriptor_vec3(descriptor: u32, byte_offset: u32, fallback: [f32; 3]) -> [f32; 3] {
    let mut value = fallback;
    for index in 0..3 {
        let candidate = unsafe { read_f32(descriptor + byte_offset + index * 4) };
        if candidate.is_finite() {
            value[index as usize] = candidate;
        }
    }
    value
}

fn mat_translation(model_pose_offset: u32, joint: u32) -> [f32; 3] {
    descriptor_vec3(model_pose_offset + joint * MAT4_BYTES, 48, [0.0; 3])
}

fn vec_add(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn vec_sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn vec_scale(a: [f32; 3], s: f32) -> [f32; 3] {
    [a[0] * s, a[1] * s, a[2] * s]
}
fn vec_dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn vec_cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn vec_length(a: [f32; 3]) -> f32 {
    libm::sqrtf(vec_dot(a, a))
}
fn vec_normalize(a: [f32; 3], fallback: [f32; 3]) -> [f32; 3] {
    let length = vec_length(a);
    if length.is_finite() && length > EPSILON {
        vec_scale(a, 1.0 / length)
    } else {
        fallback
    }
}
fn fallback_perpendicular(direction: [f32; 3]) -> [f32; 3] {
    let axis = if direction[1].abs() < 0.9 {
        [0.0, 1.0, 0.0]
    } else {
        [1.0, 0.0, 0.0]
    };
    vec_normalize(
        vec_sub(axis, vec_scale(direction, vec_dot(axis, direction))),
        [0.0, 0.0, 1.0],
    )
}
fn quat_axis_angle(axis: [f32; 3], angle: f32) -> [f32; 4] {
    let half = angle * 0.5;
    let sine = libm::sinf(half);
    let unit = vec_normalize(axis, [1.0, 0.0, 0.0]);
    normalize_quat_array([
        unit[0] * sine,
        unit[1] * sine,
        unit[2] * sine,
        libm::cosf(half),
    ])
}
fn quat_rotate(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    let qv = [q[0], q[1], q[2]];
    let uv = vec_cross(qv, v);
    let uuv = vec_cross(qv, uv);
    vec_add(v, vec_scale(vec_add(vec_scale(uv, q[3]), uuv), 2.0))
}
fn quat_from_unit_vectors(from: [f32; 3], to: [f32; 3], fallback_axis: [f32; 3]) -> [f32; 4] {
    let a = vec_normalize(from, [1.0, 0.0, 0.0]);
    let b = vec_normalize(to, a);
    let dot = vec_dot(a, b).clamp(-1.0, 1.0);
    if dot > 0.999999 {
        return [0.0, 0.0, 0.0, 1.0];
    }
    if dot < -0.999999 {
        return quat_axis_angle(
            vec_normalize(fallback_axis, fallback_perpendicular(a)),
            core::f32::consts::PI,
        );
    }
    normalize_quat_array([
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
        1.0 + dot,
    ])
}
fn weighted_quat(mut q: [f32; 4], amount: f32) -> [f32; 4] {
    let weight = if amount.is_finite() {
        amount.clamp(0.0, 1.0)
    } else {
        1.0
    };
    q = normalize_quat_array(q);
    if q[3] < 0.0 {
        for value in &mut q {
            *value = -*value;
        }
    }
    if weight <= EPSILON {
        [0.0, 0.0, 0.0, 1.0]
    } else if weight >= 1.0 {
        q
    } else {
        normalize_quat_array([
            q[0] * weight,
            q[1] * weight,
            q[2] * weight,
            1.0 + (q[3] - 1.0) * weight,
        ])
    }
}
fn matrix_rotation(model_pose_offset: u32, joint: u32) -> [f32; 4] {
    let base = model_pose_offset + joint * MAT4_BYTES;
    let x = vec_normalize(descriptor_vec3(base, 0, [1.0, 0.0, 0.0]), [1.0, 0.0, 0.0]);
    let yi = vec_normalize(descriptor_vec3(base, 16, [0.0, 1.0, 0.0]), [0.0, 1.0, 0.0]);
    let z = vec_normalize(vec_cross(x, yi), [0.0, 0.0, 1.0]);
    let y = vec_normalize(vec_cross(z, x), [0.0, 1.0, 0.0]);
    let trace = x[0] + y[1] + z[2];
    if trace > 0.0 {
        let s = libm::sqrtf(trace + 1.0) * 2.0;
        normalize_quat_array([
            (y[2] - z[1]) / s,
            (z[0] - x[2]) / s,
            (x[1] - y[0]) / s,
            0.25 * s,
        ])
    } else if x[0] > y[1] && x[0] > z[2] {
        let s = libm::sqrtf(1.0 + x[0] - y[1] - z[2]) * 2.0;
        normalize_quat_array([
            0.25 * s,
            (x[1] + y[0]) / s,
            (z[0] + x[2]) / s,
            (y[2] - z[1]) / s,
        ])
    } else if y[1] > z[2] {
        let s = libm::sqrtf(1.0 + y[1] - x[0] - z[2]) * 2.0;
        normalize_quat_array([
            (x[1] + y[0]) / s,
            0.25 * s,
            (y[2] + z[1]) / s,
            (z[0] - x[2]) / s,
        ])
    } else {
        let s = libm::sqrtf(1.0 + z[2] - x[0] - y[1]) * 2.0;
        normalize_quat_array([
            (z[0] + x[2]) / s,
            (y[2] + z[1]) / s,
            0.25 * s,
            (x[1] - y[0]) / s,
        ])
    }
}
fn model_to_local_correction(model_rotation: [f32; 4], correction: [f32; 4]) -> [f32; 4] {
    multiply_quat(
        multiply_quat(invert_quat(model_rotation), correction),
        model_rotation,
    )
}
fn apply_local_rotation(local_pose_offset: u32, joint: u32, correction: [f32; 4]) {
    let mut transform = read_transform_repaired(local_pose_offset, joint);
    let rotation = [transform[3], transform[4], transform[5], transform[6]];
    transform[3..7].copy_from_slice(&multiply_quat(rotation, correction));
    write_transform(local_pose_offset, joint, transform);
}
fn model_linear(model_pose_offset: u32, joint: u32, v: [f32; 3]) -> [f32; 3] {
    let base = model_pose_offset + joint * MAT4_BYTES;
    let x = descriptor_vec3(base, 0, [1.0, 0.0, 0.0]);
    let y = descriptor_vec3(base, 16, [0.0, 1.0, 0.0]);
    let z = descriptor_vec3(base, 32, [0.0, 0.0, 1.0]);
    [
        x[0] * v[0] + y[0] * v[1] + z[0] * v[2],
        x[1] * v[0] + y[1] * v[1] + z[1] * v[2],
        x[2] * v[0] + y[2] * v[1] + z[2] * v[2],
    ]
}
fn apply_two_bone_descriptor(local_pose_offset: u32, model_pose_offset: u32, d: u32, flags: u32) {
    let root_joint = unsafe { read_i32(d + 8) } as u32;
    let mid_joint = unsafe { read_i32(d + 12) } as u32;
    let end_joint = unsafe { read_i32(d + 16) } as u32;
    let root = mat_translation(model_pose_offset, root_joint);
    let mid = mat_translation(model_pose_offset, mid_joint);
    let end = mat_translation(model_pose_offset, end_joint);
    let target = descriptor_vec3(d, 24, end);
    let upper_v = vec_sub(mid, root);
    let lower_v = vec_sub(end, mid);
    let upper_len = vec_length(upper_v).max(1.0e-5);
    let lower_len = vec_length(lower_v).max(1.0e-5);
    let upper = vec_normalize(upper_v, [0.0, -1.0, 0.0]);
    let lower = vec_normalize(lower_v, [0.0, -1.0, 0.0]);
    let target_v = vec_sub(target, root);
    let target_len = vec_length(target_v);
    let min_reach = (upper_len - lower_len).abs();
    let solve_min = min_reach.max(1.0e-5);
    let physical_max = upper_len + lower_len;
    let soften_raw = unsafe { read_f32(d + 76) };
    let soften = if soften_raw.is_finite() {
        soften_raw.clamp(0.0, 1.0)
    } else {
        0.998
    };
    let start = physical_max * soften;
    let range = physical_max - start;
    let softened = if target_len > start && target_len > min_reach && range > EPSILON {
        let a = (target_len - start).max(0.0) / range;
        start + range - range * 81.0 / ((a + 3.0) * (a + 3.0) * (a + 3.0) * (a + 3.0))
    } else {
        target_len
    };
    let max_stretch_raw = unsafe { read_f32(d + 84) };
    let max_stretch = if max_stretch_raw.is_finite() {
        max_stretch_raw.clamp(0.0, 1.0)
    } else {
        1.0
    };
    let distance = softened.clamp(solve_min, (physical_max * max_stretch).max(solve_min));
    let direction = vec_normalize(
        target_v,
        vec_normalize(vec_sub(end, root), [0.0, -1.0, 0.0]),
    );
    let pole_input = if flags & CORRECTION_FLAG_HAS_POLE != 0 {
        descriptor_vec3(d, 36, vec_sub(mid, root))
    } else {
        vec_sub(mid, root)
    };
    let mut pole = vec_normalize(
        vec_sub(
            vec_normalize(pole_input, [0.0, 0.0, 1.0]),
            vec_scale(
                direction,
                vec_dot(vec_normalize(pole_input, [0.0, 0.0, 1.0]), direction),
            ),
        ),
        fallback_perpendicular(direction),
    );
    let twist = unsafe { read_f32(d + 72) };
    if twist.is_finite() && twist.abs() > EPSILON {
        pole = vec_normalize(quat_rotate(quat_axis_angle(direction, twist), pole), pole);
    }
    let cosine = ((upper_len * upper_len + distance * distance - lower_len * lower_len)
        / (2.0 * upper_len * distance))
        .clamp(-1.0, 1.0);
    let along = cosine * upper_len;
    let height = libm::sqrtf((upper_len * upper_len - along * along).max(0.0));
    let solved_mid = vec_add(
        vec_add(root, vec_scale(direction, along)),
        vec_scale(pole, height),
    );
    let solved_end = vec_add(root, vec_scale(direction, distance));
    let solved_upper = vec_normalize(vec_sub(solved_mid, root), upper);
    let solved_lower = vec_normalize(vec_sub(solved_end, solved_mid), lower);
    let correction_pole = if flags & CORRECTION_FLAG_HAS_POLE != 0 {
        pole_input
    } else {
        [0.0, 0.0, 1.0]
    };
    let full_root = quat_from_unit_vectors(upper, solved_upper, correction_pole);
    let root_corrected_lower = vec_normalize(quat_rotate(full_root, lower), lower);
    let mid_axis = if flags & CORRECTION_FLAG_HAS_MID_AXIS != 0 {
        model_linear(
            model_pose_offset,
            mid_joint,
            descriptor_vec3(d, 48, [0.0, 0.0, 1.0]),
        )
    } else {
        correction_pole
    };
    let full_mid = quat_from_unit_vectors(
        root_corrected_lower,
        solved_lower,
        quat_rotate(full_root, mid_axis),
    );
    let weight = unsafe { read_f32(d + 80) };
    let root_correction = weighted_quat(full_root, weight);
    let mid_correction = weighted_quat(full_mid, weight);
    let root_model = matrix_rotation(model_pose_offset, root_joint);
    let mid_model = multiply_quat(
        root_correction,
        matrix_rotation(model_pose_offset, mid_joint),
    );
    apply_local_rotation(
        local_pose_offset,
        root_joint,
        model_to_local_correction(root_model, root_correction),
    );
    apply_local_rotation(
        local_pose_offset,
        mid_joint,
        model_to_local_correction(mid_model, mid_correction),
    );
}
fn apply_aim_descriptor(
    local_pose_offset: u32,
    model_pose_offset: u32,
    d: u32,
    joint: u32,
    flags: u32,
    base: u32,
) {
    let position = mat_translation(model_pose_offset, joint);
    let rotation = matrix_rotation(model_pose_offset, joint);
    let target = descriptor_vec3(d, base, position);
    let forward_local = vec_normalize(
        descriptor_vec3(d, base + 12, [1.0, 0.0, 0.0]),
        [1.0, 0.0, 0.0],
    );
    let up_local = vec_normalize(
        descriptor_vec3(d, base + 24, [0.0, 1.0, 0.0]),
        fallback_perpendicular(forward_local),
    );
    let offset = if flags & CORRECTION_FLAG_HAS_OFFSET != 0 {
        descriptor_vec3(d, base + 48, [0.0; 3])
    } else {
        [0.0; 3]
    };
    let pole = if flags & (CORRECTION_FLAG_HAS_UP | CORRECTION_FLAG_HAS_POLE) != 0 {
        descriptor_vec3(d, base + 36, [0.0, 1.0, 0.0])
    } else {
        [0.0, 1.0, 0.0]
    };
    let forward = vec_normalize(
        model_linear(model_pose_offset, joint, forward_local),
        quat_rotate(rotation, forward_local),
    );
    let up = vec_normalize(
        model_linear(model_pose_offset, joint, up_local),
        quat_rotate(rotation, up_local),
    );
    let offset_model = model_linear(model_pose_offset, joint, offset);
    let target_v = vec_sub(target, position);
    let target_len = vec_length(target_v);
    if target_len <= 1.0e-5 {
        return;
    }
    let target_dir = vec_normalize(target_v, forward);
    let projected = vec_dot(forward, offset_model);
    let perp2 = (vec_dot(offset_model, offset_model) - projected * projected).max(0.0);
    if perp2 > target_len * target_len + 1.0e-8 {
        return;
    }
    let intersection = libm::sqrtf((target_len * target_len - perp2).max(0.0));
    let offset_forward = vec_normalize(
        vec_add(offset_model, vec_scale(forward, intersection - projected)),
        forward,
    );
    let aim = quat_from_unit_vectors(offset_forward, target_dir, up);
    let aimed_up = quat_rotate(aim, up);
    let source = vec_normalize(
        vec_sub(
            aimed_up,
            vec_scale(target_dir, vec_dot(aimed_up, target_dir)),
        ),
        fallback_perpendicular(target_dir),
    );
    let projected_pole = vec_normalize(
        vec_sub(pole, vec_scale(target_dir, vec_dot(pole, target_dir))),
        source,
    );
    let sin = vec_dot(vec_cross(source, projected_pole), target_dir);
    let cos = vec_dot(source, projected_pole).clamp(-1.0, 1.0);
    let pole_correction = if sin.abs() <= EPSILON && cos > 0.999999 {
        [0.0, 0.0, 0.0, 1.0]
    } else {
        quat_axis_angle(target_dir, libm::atan2f(sin, cos))
    };
    let twist = unsafe { read_f32(d + base + 60) };
    let mut correction = multiply_quat(pole_correction, aim);
    if twist.is_finite() && twist.abs() > EPSILON {
        correction = multiply_quat(quat_axis_angle(target_dir, twist), correction);
    }
    let weight = unsafe { read_f32(d + base + 64) };
    let correction = weighted_quat(correction, weight);
    apply_local_rotation(
        local_pose_offset,
        joint,
        model_to_local_correction(rotation, correction),
    );
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_blend_poses(
    avatar_handle: u32,
    layers_offset: u32,
    layer_count: u32,
    layers_capacity_bytes: u32,
    fallback_pose_offset: u32,
    fallback_pose_capacity_bytes: u32,
    rest_pose_offset: u32,
    rest_pose_capacity_bytes: u32,
    output_pose_offset: u32,
    output_pose_capacity_bytes: u32,
    joint_count: u32,
    threshold: f32,
) -> u32 {
    let Some(record) = avatar_record(avatar_handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    let pose_bytes = match validate_pose_job(
        record,
        joint_count,
        output_pose_offset,
        output_pose_capacity_bytes,
    ) {
        Ok(value) => value,
        Err(status) => return status,
    };
    let fallback_status = validate_pose_range(
        fallback_pose_offset,
        fallback_pose_capacity_bytes,
        pose_bytes,
    );
    if fallback_status != WA_OK {
        return fallback_status;
    }
    let rest_status = validate_pose_range(rest_pose_offset, rest_pose_capacity_bytes, pose_bytes);
    if rest_status != WA_OK {
        return rest_status;
    }
    if layer_count > MAX_JOINTS || (layer_count > 0 && !is_aligned(layers_offset, 4)) {
        return WA_ERR_INVALID_ARG;
    }
    let layer_bytes = match layer_count.checked_mul(BLEND_LAYER_BYTES) {
        Some(value) => value,
        None => return WA_ERR_CAPACITY,
    };
    if layers_capacity_bytes < layer_bytes {
        return WA_ERR_CAPACITY;
    }
    if !memory_range_valid(layers_offset, layer_bytes) {
        return WA_ERR_OOB;
    }
    for layer in 0..layer_count {
        let descriptor = layers_offset + layer * BLEND_LAYER_BYTES;
        let pose_offset = unsafe { read_u32(descriptor) };
        let pose_capacity = unsafe { read_u32(descriptor + 4) };
        let mask_offset = unsafe { read_u32(descriptor + 12) };
        let mask_count = unsafe { read_u32(descriptor + 16) };
        let mask_capacity = unsafe { read_u32(descriptor + 20) };
        if !is_aligned(pose_offset, 16) || pose_capacity < pose_bytes {
            return if !is_aligned(pose_offset, 16) {
                WA_ERR_INVALID_ARG
            } else {
                WA_ERR_CAPACITY
            };
        }
        if !memory_range_valid(pose_offset, pose_bytes) {
            return WA_ERR_OOB;
        }
        let mask_status = validate_mask(mask_offset, mask_count, mask_capacity);
        if mask_status != WA_OK {
            return mask_status;
        }
    }

    let resolved_threshold = if threshold.is_finite() {
        threshold.max(0.0)
    } else {
        0.1
    };
    blend_poses_unchecked(
        layers_offset,
        layer_count,
        fallback_pose_offset,
        rest_pose_offset,
        output_pose_offset,
        joint_count,
        resolved_threshold,
    );
    WA_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_additive_delta(
    avatar_handle: u32,
    rest_pose_offset: u32,
    rest_pose_capacity_bytes: u32,
    sample_pose_offset: u32,
    sample_pose_capacity_bytes: u32,
    output_pose_offset: u32,
    output_pose_capacity_bytes: u32,
    joint_count: u32,
) -> u32 {
    let Some(record) = avatar_record(avatar_handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    let pose_bytes = match validate_pose_job(
        record,
        joint_count,
        output_pose_offset,
        output_pose_capacity_bytes,
    ) {
        Ok(value) => value,
        Err(status) => return status,
    };
    for (offset, capacity) in [
        (rest_pose_offset, rest_pose_capacity_bytes),
        (sample_pose_offset, sample_pose_capacity_bytes),
    ] {
        let status = validate_pose_range(offset, capacity, pose_bytes);
        if status != WA_OK {
            return status;
        }
    }
    additive_delta_unchecked(
        rest_pose_offset,
        sample_pose_offset,
        output_pose_offset,
        joint_count,
    );
    WA_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_apply_additive(
    avatar_handle: u32,
    base_pose_offset: u32,
    base_pose_capacity_bytes: u32,
    delta_pose_offset: u32,
    delta_pose_capacity_bytes: u32,
    output_pose_offset: u32,
    output_pose_capacity_bytes: u32,
    joint_count: u32,
    weight: f32,
    mask_offset: u32,
    mask_count: u32,
    mask_capacity_bytes: u32,
) -> u32 {
    let Some(record) = avatar_record(avatar_handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    let pose_bytes = match validate_pose_job(
        record,
        joint_count,
        output_pose_offset,
        output_pose_capacity_bytes,
    ) {
        Ok(value) => value,
        Err(status) => return status,
    };
    for (offset, capacity) in [
        (base_pose_offset, base_pose_capacity_bytes),
        (delta_pose_offset, delta_pose_capacity_bytes),
    ] {
        let status = validate_pose_range(offset, capacity, pose_bytes);
        if status != WA_OK {
            return status;
        }
    }
    let mask_status = validate_mask(mask_offset, mask_count, mask_capacity_bytes);
    if mask_status != WA_OK {
        return mask_status;
    }
    apply_additive_unchecked(
        base_pose_offset,
        delta_pose_offset,
        output_pose_offset,
        joint_count,
        sanitize_f32(weight, 0.0),
        mask_offset,
        mask_count,
    );
    WA_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn wa_normalize_pose(
    avatar_handle: u32,
    input_pose_offset: u32,
    input_pose_capacity_bytes: u32,
    output_pose_offset: u32,
    output_pose_capacity_bytes: u32,
    joint_count: u32,
) -> u32 {
    let Some(record) = avatar_record(avatar_handle) else {
        return WA_ERR_BAD_HANDLE;
    };
    let pose_bytes = match validate_pose_job(
        record,
        joint_count,
        output_pose_offset,
        output_pose_capacity_bytes,
    ) {
        Ok(value) => value,
        Err(status) => return status,
    };
    let input_status =
        validate_pose_range(input_pose_offset, input_pose_capacity_bytes, pose_bytes);
    if input_status != WA_OK {
        return input_status;
    }
    for joint in 0..joint_count {
        let transform = read_transform_repaired(input_pose_offset, joint);
        write_transform(output_pose_offset, joint, transform);
    }
    write_padded_identity_lanes(output_pose_offset, joint_count);
    WA_OK
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
        let clips = core::ptr::addr_of_mut!(CLIPS) as *mut ClipRecord;
        for index in 0..MAX_CLIPS {
            *clips.add(index) = ClipRecord::empty();
        }
        let contexts = core::ptr::addr_of_mut!(SAMPLING_CONTEXTS) as *mut SamplingContextRecord;
        for index in 0..MAX_SAMPLING_CONTEXTS {
            *contexts.add(index) = SamplingContextRecord::empty();
        }
        let skinning_jobs = core::ptr::addr_of_mut!(SKINNING_JOBS) as *mut SkinningJobRecord;
        for index in 0..MAX_SKINNING_JOBS {
            *skinning_jobs.add(index) = SkinningJobRecord::empty();
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

fn validate_pose_job(
    record: AvatarRecord,
    joint_count: u32,
    output_pose_offset: u32,
    output_pose_capacity_bytes: u32,
) -> Result<u32, u32> {
    if joint_count == 0 || joint_count > record.joint_count || joint_count > MAX_JOINTS {
        return Err(WA_ERR_INVALID_ARG);
    }
    let pose_bytes = group_count(joint_count)
        .checked_mul(SOA_TRANSFORM_BYTES)
        .ok_or(WA_ERR_CAPACITY)?;
    let status = validate_pose_range(output_pose_offset, output_pose_capacity_bytes, pose_bytes);
    if status == WA_OK {
        Ok(pose_bytes)
    } else {
        Err(status)
    }
}

fn validate_pose_range(offset: u32, capacity_bytes: u32, required_bytes: u32) -> u32 {
    if !is_aligned(offset, 16) {
        return WA_ERR_INVALID_ARG;
    }
    if capacity_bytes < required_bytes {
        return WA_ERR_CAPACITY;
    }
    if !memory_range_valid(offset, required_bytes) {
        return WA_ERR_OOB;
    }
    WA_OK
}

fn validate_mask(offset: u32, count: u32, capacity_bytes: u32) -> u32 {
    if count == 0 && offset == 0 {
        return WA_OK;
    }
    if !is_aligned(offset, 4) {
        return WA_ERR_INVALID_ARG;
    }
    let required = match count.checked_mul(F32_BYTES) {
        Some(value) => value,
        None => return WA_ERR_CAPACITY,
    };
    if capacity_bytes < required {
        return WA_ERR_CAPACITY;
    }
    if !memory_range_valid(offset, required) {
        return WA_ERR_OOB;
    }
    WA_OK
}

fn blend_poses_unchecked(
    layers_offset: u32,
    layer_count: u32,
    fallback_pose_offset: u32,
    rest_pose_offset: u32,
    output_pose_offset: u32,
    joint_count: u32,
    threshold: f32,
) {
    let mut has_any_layer = false;
    for layer in 0..layer_count {
        let weight = unsafe { read_f32(layers_offset + layer * BLEND_LAYER_BYTES + 8) };
        if weight.is_finite() && weight > 0.0 {
            has_any_layer = true;
            break;
        }
    }

    for joint in 0..joint_count {
        let mut rotation_sum = [0.0f32; 4];
        let mut translation_sum = [0.0f32; 3];
        let mut scale_sum = [0.0f32; 3];
        let mut total_weight = 0.0f32;

        for layer in 0..layer_count {
            let descriptor = layers_offset + layer * BLEND_LAYER_BYTES;
            let layer_weight = unsafe { read_f32(descriptor + 8) };
            if !layer_weight.is_finite() || layer_weight <= 0.0 {
                continue;
            }
            let mask_offset = unsafe { read_u32(descriptor + 12) };
            let mask_count = unsafe { read_u32(descriptor + 16) };
            let mask_weight = read_mask_weight(mask_offset, mask_count, joint);
            let weight = layer_weight * mask_weight;
            if !weight.is_finite() || weight <= 0.0 {
                continue;
            }
            let pose_offset = unsafe { read_u32(descriptor) };
            let transform = read_transform_raw(pose_offset, joint);
            if !transform_is_finite(&transform) {
                continue;
            }
            accumulate_transform(
                &mut rotation_sum,
                &mut translation_sum,
                &mut scale_sum,
                &transform,
                weight,
            );
            total_weight += weight;
        }

        let requested_fallback = read_transform_raw(fallback_pose_offset, joint);
        let fallback_raw = if transform_is_finite(&requested_fallback) {
            requested_fallback
        } else {
            read_transform_raw(rest_pose_offset, joint)
        };
        let fallback = normalize_transform(fallback_raw);
        if threshold > 0.0 && (!has_any_layer || total_weight < threshold) {
            let fallback_weight = if has_any_layer {
                threshold - total_weight
            } else {
                1.0
            };
            if fallback_weight > 0.0 {
                accumulate_transform(
                    &mut rotation_sum,
                    &mut translation_sum,
                    &mut scale_sum,
                    &fallback,
                    fallback_weight,
                );
                total_weight += fallback_weight;
            }
        }

        let output = if !total_weight.is_finite() || total_weight <= 0.0 {
            fallback
        } else {
            let inverse = 1.0 / total_weight;
            normalize_transform([
                translation_sum[0] * inverse,
                translation_sum[1] * inverse,
                translation_sum[2] * inverse,
                rotation_sum[0],
                rotation_sum[1],
                rotation_sum[2],
                rotation_sum[3],
                scale_sum[0] * inverse,
                scale_sum[1] * inverse,
                scale_sum[2] * inverse,
            ])
        };
        write_transform(output_pose_offset, joint, output);
    }
    write_padded_identity_lanes(output_pose_offset, joint_count);
}

fn accumulate_transform(
    rotation_sum: &mut [f32; 4],
    translation_sum: &mut [f32; 3],
    scale_sum: &mut [f32; 3],
    transform: &[f32; TRANSFORM_COMPONENTS],
    weight: f32,
) {
    let normalized = normalize_quat(transform[3], transform[4], transform[5], transform[6]);
    let mut rotation = [normalized.0, normalized.1, normalized.2, normalized.3];
    let has_existing = rotation_sum.iter().map(|value| value.abs()).sum::<f32>() > 0.0;
    let reference = if has_existing {
        let normalized_sum = normalize_quat(
            rotation_sum[0],
            rotation_sum[1],
            rotation_sum[2],
            rotation_sum[3],
        );
        [
            normalized_sum.0,
            normalized_sum.1,
            normalized_sum.2,
            normalized_sum.3,
        ]
    } else {
        rotation
    };
    if dot_quat(reference, rotation) < 0.0 {
        for value in &mut rotation {
            *value = -*value;
        }
    }
    for index in 0..3 {
        translation_sum[index] += transform[index] * weight;
        scale_sum[index] += transform[index + 7] * weight;
    }
    for index in 0..4 {
        rotation_sum[index] += rotation[index] * weight;
    }
}

fn additive_delta_unchecked(
    rest_pose_offset: u32,
    sample_pose_offset: u32,
    output_pose_offset: u32,
    joint_count: u32,
) {
    for joint in 0..joint_count {
        let rest = read_transform_raw(rest_pose_offset, joint);
        let sample = read_transform_raw(sample_pose_offset, joint);
        let inverse_rest = invert_quat([rest[3], rest[4], rest[5], rest[6]]);
        let delta_rotation =
            multiply_quat(inverse_rest, [sample[3], sample[4], sample[5], sample[6]]);
        write_transform(
            output_pose_offset,
            joint,
            [
                sample[0] - rest[0],
                sample[1] - rest[1],
                sample[2] - rest[2],
                delta_rotation[0],
                delta_rotation[1],
                delta_rotation[2],
                delta_rotation[3],
                scale_ratio(sample[7], rest[7]),
                scale_ratio(sample[8], rest[8]),
                scale_ratio(sample[9], rest[9]),
            ],
        );
    }
    write_padded_identity_lanes(output_pose_offset, joint_count);
}

#[allow(clippy::too_many_arguments)]
fn apply_additive_unchecked(
    base_pose_offset: u32,
    delta_pose_offset: u32,
    output_pose_offset: u32,
    joint_count: u32,
    layer_weight: f32,
    mask_offset: u32,
    mask_count: u32,
) {
    for joint in 0..joint_count {
        let base = read_transform_repaired(base_pose_offset, joint);
        let delta = read_transform_raw(delta_pose_offset, joint);
        let amount = layer_weight * read_mask_weight(mask_offset, mask_count, joint);
        let output =
            if !amount.is_finite() || amount.abs() <= EPSILON || !transform_is_finite(&delta) {
                base
            } else {
                apply_transform_delta(base, delta, amount)
            };
        write_transform(output_pose_offset, joint, output);
    }
    write_padded_identity_lanes(output_pose_offset, joint_count);
}

fn apply_transform_delta(
    base: [f32; TRANSFORM_COMPONENTS],
    delta: [f32; TRANSFORM_COMPONENTS],
    amount: f32,
) -> [f32; TRANSFORM_COMPONENTS] {
    let mut delta_rotation = [delta[3], delta[4], delta[5], delta[6]];
    if delta_rotation[3] < 0.0 {
        for value in &mut delta_rotation {
            *value = -*value;
        }
    }
    let absolute = amount.abs();
    let weighted_rotation = normalize_quat_array([
        delta_rotation[0] * absolute,
        delta_rotation[1] * absolute,
        delta_rotation[2] * absolute,
        1.0 + (delta_rotation[3] - 1.0) * absolute,
    ]);
    let applied_rotation = if amount >= 0.0 {
        weighted_rotation
    } else {
        [
            -weighted_rotation[0],
            -weighted_rotation[1],
            -weighted_rotation[2],
            weighted_rotation[3],
        ]
    };
    let rotation = multiply_quat([base[3], base[4], base[5], base[6]], applied_rotation);
    [
        base[0] + delta[0] * amount,
        base[1] + delta[1] * amount,
        base[2] + delta[2] * amount,
        rotation[0],
        rotation[1],
        rotation[2],
        rotation[3],
        apply_scale_delta(base[7], delta[7], absolute, amount >= 0.0),
        apply_scale_delta(base[8], delta[8], absolute, amount >= 0.0),
        apply_scale_delta(base[9], delta[9], absolute, amount >= 0.0),
    ]
}

fn apply_scale_delta(base: f32, delta: f32, absolute: f32, positive: bool) -> f32 {
    let factor = 1.0 + (delta - 1.0) * absolute;
    if positive {
        base * factor
    } else {
        scale_ratio(base, factor)
    }
}

fn read_mask_weight(offset: u32, count: u32, joint: u32) -> f32 {
    if offset == 0 && count == 0 {
        return 1.0;
    }
    if joint >= count {
        return 0.0;
    }
    let value = unsafe { read_f32(offset + joint * F32_BYTES) };
    if value.is_finite() && value >= 0.0 {
        value
    } else {
        0.0
    }
}

fn read_transform_raw(offset: u32, joint: u32) -> [f32; TRANSFORM_COMPONENTS] {
    let group = joint >> 2;
    let lane = joint & 3;
    let base = offset + group * SOA_TRANSFORM_BYTES;
    let mut transform = [0.0; TRANSFORM_COMPONENTS];
    for (field, value) in transform.iter_mut().enumerate() {
        *value = unsafe { read_f32(base + (field as u32 * 4 + lane) * F32_BYTES) };
    }
    transform
}

fn read_transform_repaired(offset: u32, joint: u32) -> [f32; TRANSFORM_COMPONENTS] {
    normalize_transform(read_transform_raw(offset, joint))
}

fn write_transform(offset: u32, joint: u32, transform: [f32; TRANSFORM_COMPONENTS]) {
    let group = joint >> 2;
    let lane = joint & 3;
    let base = offset + group * SOA_TRANSFORM_BYTES;
    for (field, value) in transform.iter().enumerate() {
        unsafe { write_f32(base + (field as u32 * 4 + lane) * F32_BYTES, *value) };
    }
}

fn write_padded_identity_lanes(offset: u32, joint_count: u32) {
    let padded_count = group_count(joint_count) * 4;
    for joint in joint_count..padded_count {
        write_transform(
            offset,
            joint,
            [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0],
        );
    }
}

fn transform_is_finite(transform: &[f32; TRANSFORM_COMPONENTS]) -> bool {
    transform.iter().all(|value| value.is_finite())
        && libm_hypot4(transform[3], transform[4], transform[5], transform[6]) > EPSILON
}

fn normalize_transform(mut transform: [f32; TRANSFORM_COMPONENTS]) -> [f32; TRANSFORM_COMPONENTS] {
    for value in &mut transform[..3] {
        *value = sanitize_f32(*value, 0.0);
    }
    let rotation = normalize_quat(transform[3], transform[4], transform[5], transform[6]);
    transform[3] = rotation.0;
    transform[4] = rotation.1;
    transform[5] = rotation.2;
    transform[6] = rotation.3;
    for value in &mut transform[7..] {
        *value = sanitize_f32(*value, 1.0);
    }
    transform
}

fn normalize_quat_array(value: [f32; 4]) -> [f32; 4] {
    let normalized = normalize_quat(value[0], value[1], value[2], value[3]);
    [normalized.0, normalized.1, normalized.2, normalized.3]
}

fn dot_quat(a: [f32; 4], b: [f32; 4]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
}

fn invert_quat(value: [f32; 4]) -> [f32; 4] {
    let dot = dot_quat(value, value);
    if !dot.is_finite() || dot <= EPSILON {
        return [0.0, 0.0, 0.0, 1.0];
    }
    [
        -value[0] / dot,
        -value[1] / dot,
        -value[2] / dot,
        value[3] / dot,
    ]
}

fn multiply_quat(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    normalize_quat_array([
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ])
}

fn scale_ratio(numerator: f32, denominator: f32) -> f32 {
    if !numerator.is_finite() || !denominator.is_finite() {
        return 0.0;
    }
    let resolved_denominator = if denominator.abs() > EPSILON {
        denominator
    } else if denominator.is_sign_negative() {
        -EPSILON
    } else {
        EPSILON
    };
    let ratio = numerator / resolved_denominator;
    if ratio.is_finite() {
        ratio
    } else if numerator == 0.0 {
        0.0
    } else if numerator.is_sign_negative() != resolved_denominator.is_sign_negative() {
        -f32::MAX
    } else {
        f32::MAX
    }
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

fn required_strided_values(count: u32, stride: u32, components: u32) -> Option<u32> {
    if count == 0 || components == 0 {
        return Some(0);
    }
    count
        .checked_sub(1)?
        .checked_mul(stride)?
        .checked_add(components)
}

fn required_strided_bytes(count: u32, offset: u32, stride: u32, components: u32) -> Option<u32> {
    offset
        .checked_add(required_strided_values(count, stride, components)?)?
        .checked_mul(F32_BYTES)
}

fn ranges_overlap(a_offset: u32, a_bytes: u32, b_offset: u32, b_bytes: u32) -> bool {
    if a_bytes == 0 || b_bytes == 0 {
        return false;
    }
    let a_end = a_offset.saturating_add(a_bytes);
    let b_end = b_offset.saturating_add(b_bytes);
    a_offset < b_end && b_offset < a_end
}

fn sanitize_index(value: f32, length: u32) -> u32 {
    if !value.is_finite() || value < 0.0 || libm::floorf(value) != value || value >= length as f32 {
        0
    } else {
        value as u32
    }
}

fn read_mat4_repaired(offset: u32, fallback: Option<&[f32; 16]>) -> [f32; 16] {
    let mut matrix = [0.0; 16];
    for (index, component) in matrix.iter_mut().enumerate() {
        *component = unsafe { read_f32(offset + index as u32 * F32_BYTES) };
    }
    if matrix.iter().all(|value| value.is_finite()) {
        matrix
    } else if let Some(value) = fallback {
        *value
    } else {
        [
            1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ]
    }
}

fn multiply_mat4_arrays(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
    #[cfg(all(target_arch = "wasm32", feature = "simd"))]
    {
        multiply_mat4_arrays_simd(a, b)
    }
    #[cfg(not(all(target_arch = "wasm32", feature = "simd")))]
    {
        let mut out = [0.0; 16];
        for column in 0..4 {
            for row in 0..4 {
                out[column * 4 + row] = a[row] * b[column * 4]
                    + a[4 + row] * b[column * 4 + 1]
                    + a[8 + row] * b[column * 4 + 2]
                    + a[12 + row] * b[column * 4 + 3];
            }
        }
        out
    }
}

#[cfg(all(target_arch = "wasm32", feature = "simd"))]
fn multiply_mat4_arrays_simd(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
    let mut out = [0.0; 16];
    unsafe {
        let a0 = wasm32::v128_load(a.as_ptr().cast());
        let a1 = wasm32::v128_load(a.as_ptr().add(4).cast());
        let a2 = wasm32::v128_load(a.as_ptr().add(8).cast());
        let a3 = wasm32::v128_load(a.as_ptr().add(12).cast());
        for column in 0..4usize {
            let base = column * 4;
            let c0 = wasm32::f32x4_mul(a0, wasm32::f32x4_splat(b[base]));
            let c1 = wasm32::f32x4_mul(a1, wasm32::f32x4_splat(b[base + 1]));
            let c2 = wasm32::f32x4_mul(a2, wasm32::f32x4_splat(b[base + 2]));
            let c3 = wasm32::f32x4_mul(a3, wasm32::f32x4_splat(b[base + 3]));
            let sum = wasm32::f32x4_add(wasm32::f32x4_add(c0, c1), wasm32::f32x4_add(c2, c3));
            wasm32::v128_store(out.as_mut_ptr().add(base).cast(), sum);
        }
        SIMD_EXECUTION_COUNT = SIMD_EXECUTION_COUNT.wrapping_add(1);
    }
    out
}

fn read_vec3_repaired(offset: u32) -> [f32; 3] {
    [
        sanitize_f32(unsafe { read_f32(offset) }, 0.0),
        sanitize_f32(unsafe { read_f32(offset + F32_BYTES) }, 0.0),
        sanitize_f32(unsafe { read_f32(offset + 2 * F32_BYTES) }, 0.0),
    ]
}

fn write_vec3_repaired(offset: u32, value: [f32; 3]) {
    for (index, component) in value.iter().enumerate() {
        unsafe {
            write_f32(
                offset + index as u32 * F32_BYTES,
                if component.is_finite() {
                    *component
                } else {
                    0.0
                },
            )
        };
    }
}

fn explicit_weight_sum(job: SkinningJobRecord, vertex: u32) -> f32 {
    let mut sum = 0.0;
    for influence in 0..job.influences {
        let slot = vertex * job.weight_stride + influence;
        let candidate = sanitize_f32(
            unsafe { read_f32(job.weights_offset + slot * F32_BYTES) },
            0.0,
        )
        .clamp(0.0, 1.0);
        sum += candidate;
    }
    sum
}

fn resolve_skin_weight(
    job: SkinningJobRecord,
    vertex: u32,
    influence: u32,
    explicit_sum: f32,
    restored_sum: &mut f32,
) -> f32 {
    if job.weight_mode == SKIN_WEIGHT_EXPLICIT {
        let slot = vertex * job.weight_stride + influence;
        let candidate = sanitize_f32(
            unsafe { read_f32(job.weights_offset + slot * F32_BYTES) },
            0.0,
        )
        .clamp(0.0, 1.0);
        if explicit_sum > 1.0 {
            candidate / explicit_sum
        } else if explicit_sum <= 0.0 {
            f32::from(influence == 0)
        } else {
            candidate
        }
    } else if influence + 1 == job.influences {
        (1.0 - *restored_sum).max(0.0)
    } else {
        let slot = vertex * job.weight_stride + influence;
        let candidate = sanitize_f32(
            unsafe { read_f32(job.weights_offset + slot * F32_BYTES) },
            0.0,
        )
        .clamp(0.0, 1.0);
        let weight = candidate.min((1.0 - *restored_sum).max(0.0));
        *restored_sum += weight;
        weight
    }
}

fn accumulate_point(out: &mut [f32; 3], matrix: &[f32; 16], value: [f32; 3], weight: f32) {
    out[0] +=
        (matrix[0] * value[0] + matrix[4] * value[1] + matrix[8] * value[2] + matrix[12]) * weight;
    out[1] +=
        (matrix[1] * value[0] + matrix[5] * value[1] + matrix[9] * value[2] + matrix[13]) * weight;
    out[2] +=
        (matrix[2] * value[0] + matrix[6] * value[1] + matrix[10] * value[2] + matrix[14]) * weight;
}

fn accumulate_vector(out: &mut [f32; 3], matrix: &[f32; 16], value: [f32; 3], weight: f32) {
    out[0] += (matrix[0] * value[0] + matrix[4] * value[1] + matrix[8] * value[2]) * weight;
    out[1] += (matrix[1] * value[0] + matrix[5] * value[1] + matrix[9] * value[2]) * weight;
    out[2] += (matrix[2] * value[0] + matrix[6] * value[1] + matrix[10] * value[2]) * weight;
}

fn read_soa_f32(base: u32, field: u32, lane: u32, fallback: f32) -> f32 {
    let offset = base + (field * 4 + lane) * 4;
    sanitize_f32(unsafe { read_f32(offset) }, fallback)
}

fn multiply_to_offset(a_offset: u32, b_ptr: *const f32, out_offset: u32) {
    #[cfg(all(target_arch = "wasm32", feature = "simd"))]
    unsafe {
        let a = a_offset as *const f32;
        let out = out_offset as *mut f32;
        let a0 = wasm32::v128_load(a.cast());
        let a1 = wasm32::v128_load(a.add(4).cast());
        let a2 = wasm32::v128_load(a.add(8).cast());
        let a3 = wasm32::v128_load(a.add(12).cast());
        for column in 0..4usize {
            let base = column * 4;
            let c0 = wasm32::f32x4_mul(a0, wasm32::f32x4_splat(*b_ptr.add(base)));
            let c1 = wasm32::f32x4_mul(a1, wasm32::f32x4_splat(*b_ptr.add(base + 1)));
            let c2 = wasm32::f32x4_mul(a2, wasm32::f32x4_splat(*b_ptr.add(base + 2)));
            let c3 = wasm32::f32x4_mul(a3, wasm32::f32x4_splat(*b_ptr.add(base + 3)));
            let sum = wasm32::f32x4_add(wasm32::f32x4_add(c0, c1), wasm32::f32x4_add(c2, c3));
            wasm32::v128_store(out.add(base).cast(), sum);
        }
        SIMD_EXECUTION_COUNT = SIMD_EXECUTION_COUNT.wrapping_add(1);
    }
    #[cfg(not(all(target_arch = "wasm32", feature = "simd")))]
    {
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
    if handle & HANDLE_KIND_MASK != HANDLE_KIND_SKELETON {
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
        && handle & HANDLE_KIND_MASK == HANDLE_KIND_SKELETON
}

fn avatar_record(handle: u32) -> Option<AvatarRecord> {
    if handle & HANDLE_KIND_MASK != HANDLE_KIND_AVATAR {
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
        && handle & HANDLE_KIND_MASK == HANDLE_KIND_AVATAR
}

fn clip_record(handle: u32) -> Option<ClipRecord> {
    if handle & HANDLE_KIND_MASK != HANDLE_KIND_CLIP {
        return None;
    }
    let slot = handle_slot(handle)?;
    unsafe {
        let record = *((core::ptr::addr_of!(CLIPS) as *const ClipRecord).add(slot));
        if clip_matches_handle(record, handle) {
            Some(record)
        } else {
            None
        }
    }
}

fn clip_matches_handle(record: ClipRecord, handle: u32) -> bool {
    record.magic == CLIP_MAGIC
        && record.generation == handle_generation(handle)
        && handle & HANDLE_KIND_MASK == HANDLE_KIND_CLIP
        && handle & HANDLE_SKINNING_TAG == 0
}

fn skinning_job_record(handle: u32) -> Option<SkinningJobRecord> {
    if handle & HANDLE_KIND_MASK != HANDLE_KIND_CLIP || handle & HANDLE_SKINNING_TAG == 0 {
        return None;
    }
    let slot = handle_slot(handle)?;
    unsafe {
        let record = *((core::ptr::addr_of!(SKINNING_JOBS) as *const SkinningJobRecord).add(slot));
        if skinning_job_matches_handle(record, handle) {
            Some(record)
        } else {
            None
        }
    }
}

fn skinning_job_matches_handle(record: SkinningJobRecord, handle: u32) -> bool {
    record.magic == SKINNING_JOB_MAGIC
        && record.generation == handle_generation(handle)
        && handle & HANDLE_KIND_MASK == HANDLE_KIND_CLIP
        && handle & HANDLE_SKINNING_TAG != 0
}

fn sampling_context_record_mut(handle: u32) -> Option<&'static mut SamplingContextRecord> {
    if handle & HANDLE_KIND_MASK != HANDLE_KIND_SAMPLING_CONTEXT {
        return None;
    }
    let slot = handle_slot(handle)?;
    unsafe {
        let record = &mut *((core::ptr::addr_of_mut!(SAMPLING_CONTEXTS)
            as *mut SamplingContextRecord)
            .add(slot));
        if sampling_context_matches_handle(*record, handle) {
            Some(record)
        } else {
            None
        }
    }
}

fn sampling_context_matches_handle(record: SamplingContextRecord, handle: u32) -> bool {
    record.magic == SAMPLING_CONTEXT_MAGIC
        && record.generation == handle_generation(handle)
        && handle & HANDLE_KIND_MASK == HANDLE_KIND_SAMPLING_CONTEXT
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

fn find_free_clip_slot() -> Option<usize> {
    unsafe {
        let records = core::ptr::addr_of!(CLIPS) as *const ClipRecord;
        for slot in 0..MAX_CLIPS {
            let skinning = core::ptr::addr_of!(SKINNING_JOBS) as *const SkinningJobRecord;
            if (*records.add(slot)).magic != CLIP_MAGIC
                && (*skinning.add(slot)).magic != SKINNING_JOB_MAGIC
            {
                return Some(slot);
            }
        }
    }
    None
}

fn find_free_skinning_job_slot() -> Option<usize> {
    unsafe {
        let records = core::ptr::addr_of!(SKINNING_JOBS) as *const SkinningJobRecord;
        let clips = core::ptr::addr_of!(CLIPS) as *const ClipRecord;
        for slot in 0..MAX_SKINNING_JOBS {
            if (*records.add(slot)).magic != SKINNING_JOB_MAGIC
                && (*clips.add(slot)).magic != CLIP_MAGIC
            {
                return Some(slot);
            }
        }
    }
    None
}

fn find_free_sampling_context_slot() -> Option<usize> {
    unsafe {
        let records = core::ptr::addr_of!(SAMPLING_CONTEXTS) as *const SamplingContextRecord;
        for slot in 0..MAX_SAMPLING_CONTEXTS {
            if (*records.add(slot)).magic != SAMPLING_CONTEXT_MAGIC {
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

    #[test]
    fn scale_ratio_preserves_signed_zero_denominators() {
        assert_eq!(scale_ratio(2.0, 0.0), 200_000_000.0);
        assert_eq!(scale_ratio(2.0, -0.0), -200_000_000.0);
        assert_eq!(scale_ratio(-2.0, 0.0), -200_000_000.0);
        assert_eq!(scale_ratio(f32::NAN, 1.0), 0.0);
    }

    #[test]
    fn signed_additive_rotation_stays_normalized() {
        let base = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0];
        let delta = [
            0.25,
            -0.5,
            1.0,
            0.0,
            0.382_683_43,
            0.0,
            0.923_879_5,
            2.0,
            0.5,
            -1.0,
        ];
        for weight in [-0.5, 0.5] {
            let output = apply_transform_delta(base, delta, weight);
            let length = libm_hypot4(output[3], output[4], output[5], output[6]);
            assert!((length - 1.0).abs() < 1.0e-6);
            assert!(output.iter().all(|value| value.is_finite()));
        }
    }
}
