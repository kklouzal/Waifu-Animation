import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const forbiddenExports = [
  "sampleClipToPose",
  "samplePackedRuntimeAnimationToPose",
  "blendPoses",
  "normalizePose",
  "additiveDeltaPose",
  "applyAdditivePose",
  "localToModelPose",
  "updateLocalToModelPoseRange",
  "buildSkinningMatrixPalette",
  "skinVertices",
  "sampleMotionCarrier",
  "sampleMotionIntervalDelta",
  "solveAimIk",
  "solveTwoBoneIk"
];
const declaration = readFileSync("dist/index.d.ts", "utf8");
const runtime = await import(new URL("../dist/index.js", import.meta.url));
for (const name of forbiddenExports) {
  if (new RegExp(`\\b${name}\\b`).test(declaration) || name in runtime)
    throw new Error(`legacy numeric API shipped from package root: ${name}`);
}
const runtimeSource = readFileSync("src/runtime.ts", "utf8");
if (/kind\s*:\s*["']typescript["']|backend\?\.|private readonly backend\s*:\s*[^;]*undefined/.test(runtimeSource))
  throw new Error("backend-less or TypeScript runtime fallback remains");
for (const file of readdirSync("dist")) {
  if (file.includes("reference") || file.startsWith("tests"))
    throw new Error(`test reference shipped: ${join("dist", file)}`);
}
console.log("shipped runtime audit passed");
