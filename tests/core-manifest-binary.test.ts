import { runCoreBinaryValidationTests } from "./core-binary-validation.test.js";
import { runCoreManifestValidationTests } from "./core-manifest-validation.test.js";
import { runCoreRootMotionValidationTests } from "./core-root-motion-validation.test.js";
import { runCoreRuntimeTargetValidationTests } from "./core-runtime-target-validation.test.js";

export async function runCoreManifestBinaryTests(): Promise<void> {
  await runCoreManifestValidationTests();
  await runCoreRuntimeTargetValidationTests();
  await runCoreBinaryValidationTests();
  await runCoreRootMotionValidationTests();
}
