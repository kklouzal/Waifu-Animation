import { createAnimationMetricsEvaluation, runAnimationMetricsTests } from "./animation-metrics.test.js";
import { runIkFootPlantTests } from "./ik-foot-plant.test.js";
import { runFacialAnimationTests, runPresencePlanningTests, runPresenceTargetTests } from "./presence-facial.test.js";
import { runRetargetingTests } from "./retargeting.test.js";

export async function runRetargetingIkFacialTests(): Promise<void> {
  const metricsEvaluation = createAnimationMetricsEvaluation();

  runPresenceTargetTests();
  runRetargetingTests();
  runPresencePlanningTests();
  runIkFootPlantTests();
  runFacialAnimationTests();
  runAnimationMetricsTests(metricsEvaluation);
}
