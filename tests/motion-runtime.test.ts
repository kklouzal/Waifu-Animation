import {
  runMotionAttachmentTests,
  runMotionRuntimeDiagnosticTests,
  runMotionThreeRuntimeUtilityTests
} from "./motion-attachments-runtime.test.js";
import { runMotionPosePolicyTests } from "./motion-pose-policy.test.js";
import { runMotionPoseSamplingTests } from "./motion-pose-sampling.test.js";
import { runMotionRootMotionTests, runMotionRuntimeRootMotionTests } from "./motion-root-motion.test.js";
import { runMotionSkinningGeometryTests } from "./motion-skinning-geometry.test.js";

export async function runMotionRuntimeTests(): Promise<void> {
  await runMotionRootMotionTests();
  await runMotionPoseSamplingTests();
  await runMotionSkinningGeometryTests();
  await runMotionAttachmentTests();
  await runMotionPosePolicyTests();
  await runMotionThreeRuntimeUtilityTests();
  await runMotionRuntimeRootMotionTests();
  await runMotionRuntimeDiagnosticTests();
}
