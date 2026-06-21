import { runCoreManifestBinaryTests } from "./core-manifest-binary.test.js";
import { runCoreMathTrackTests } from "./core-math-tracks.test.js";
import { runCoreSamplingPackedTests } from "./core-sampling-packed.test.js";
import { runCoreSkeletonAnimationTests } from "./core-skeleton-animation.test.js";

export async function runCoreDataTests(): Promise<void> {
  await runCoreMathTrackTests();
  const rawAnimationFixtures = await runCoreSkeletonAnimationTests();
  await runCoreManifestBinaryTests();
  await runCoreSamplingPackedTests(rawAnimationFixtures);
}
