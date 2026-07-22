import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "crates", "waifu-animation-kernel", "Cargo.toml");
const wasmOut = join(repoRoot, "target", "wasm32-unknown-unknown", "release", "waifu_animation_kernel.wasm");
const distDir = join(repoRoot, "dist", "wasm-kernel");
const distWasm = join(distDir, "waifu_animation_kernel.wasm");
const distReadme = join(distDir, "README.md");

const cargo = findCargo();
const cargoResult = spawnSync(
  cargo,
  ["build", "--manifest-path", manifestPath, "--release", "--target", "wasm32-unknown-unknown", "--locked"],
  { cwd: repoRoot, stdio: "inherit" }
);
if (cargoResult.status !== 0) process.exit(cargoResult.status ?? 1);
if (!existsSync(wasmOut)) throw new Error(`Rust build did not produce ${wasmOut}`);

mkdirSync(distDir, { recursive: true });
copyFileSync(wasmOut, distWasm);
writeFileSync(
  distReadme,
  [
    "# waifu-animation WASM kernel asset",
    "",
    "This scalar WASM binary is generated from `crates/waifu-animation-kernel` by `npm run build:wasm`.",
    "It is intentionally packed under `dist/wasm-kernel/` so applications can opt in with an explicit URL, bytes, or precompiled module strategy.",
    "ABI v1.4 feature-gates retained packed sampling, pose composition, local-to-model, model × inverse-bind palettes, optional CPU skinning, and retained procedural correction descriptors.",
    "The TypeScript public APIs remain scalar-safe when this asset is not loaded or initialization fails.",
    ""
  ].join("\n")
);

const size = statSync(distWasm).size;
console.log(`waifu-animation WASM kernel: copied ${distWasm} (${size} bytes)`);

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
