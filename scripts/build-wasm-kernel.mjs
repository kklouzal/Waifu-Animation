import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "crates", "waifu-animation-kernel", "Cargo.toml");
const distDir = join(repoRoot, "dist", "wasm-kernel");
const scalarTarget = join(repoRoot, "target", "wasm-scalar");
const simdTarget = join(repoRoot, "target", "wasm-simd");
const variants = [
  { name: "scalar", target: scalarTarget, rustflags: "", features: [] },
  { name: "simd", target: simdTarget, rustflags: "-C target-feature=+simd128", features: ["--features", "simd"] }
];
const distReadme = join(distDir, "README.md");

const cargo = findCargo();
mkdirSync(distDir, { recursive: true });
rmSync(join(distDir, "waifu_animation_kernel.wasm"), { force: true });
for (const variant of variants) {
  const cargoResult = spawnSync(
    cargo,
    [
      "build",
      "--manifest-path",
      manifestPath,
      "--release",
      "--target",
      "wasm32-unknown-unknown",
      "--locked",
      ...variant.features
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        CARGO_TARGET_DIR: variant.target,
        ...(variant.rustflags ? { RUSTFLAGS: variant.rustflags } : {})
      }
    }
  );
  if (cargoResult.status !== 0) process.exit(cargoResult.status ?? 1);
  const wasmOut = join(variant.target, "wasm32-unknown-unknown", "release", "waifu_animation_kernel.wasm");
  if (!existsSync(wasmOut)) throw new Error(`Rust build did not produce ${wasmOut}`);
  const distWasm = join(distDir, `waifu_animation_kernel.${variant.name}.wasm`);
  copyFileSync(wasmOut, distWasm);
  console.log(`waifu-animation WASM kernel: copied ${distWasm} (${statSync(distWasm).size} bytes)`);
}
writeFileSync(
  distReadme,
  [
    "# waifu-animation WASM kernel asset",
    "",
    "The mandatory kernel is generated from `crates/waifu-animation-kernel` by `npm run build:wasm`.",
    "`waifu_animation_kernel.simd.wasm` uses SIMD128 matrix lanes; `waifu_animation_kernel.scalar.wasm` is the non-SIMD browser compatibility artifact.",
    "The loader feature-detects SIMD, prefers it, and fails closed if neither selected asset initializes. There is no TypeScript numeric fallback.",
    "ABI v1.5 reports its actual execution mode and exposes a SIMD execution counter for artifact/dispatch verification.",
    ""
  ].join("\n")
);

function findCargo() {
  const candidates = [
    process.env.CARGO,
    "cargo",
    join(homedir(), ".cargo", "bin", process.platform === "win32" ? "cargo.exe" : "cargo")
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) return candidate;
  }
  throw new Error(
    "cargo was not found; install Rust with the wasm32-unknown-unknown target or set CARGO=/path/to/cargo"
  );
}
