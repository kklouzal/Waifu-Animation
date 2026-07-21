import { runCharacterAnimationBindingTests } from "./character-animation-binding.test.js";
import { runCharacterAnimationGraphTests } from "./character-animation-graph.test.js";
import { runCharacterAnimationRuntimeApplierTests } from "./character-animation-runtime-applier.test.js";
import { runCharacterControllerTests } from "./character-controller.test.js";
import { runCoreDataTests } from "./core-data.test.js";
import { runMotionRuntimeTests } from "./motion-runtime.test.js";
import { runInteractionCoordinatorTests } from "./interactions.test.js";
import { runNavigationWorldCoordinatorTests } from "./navigation-world-coordinator.test.js";
import { runRootMotionAuthorityTests } from "./root-motion-authority.test.js";
import { runRetargetingIkFacialTests } from "./retargeting-ik-facial.test.js";
import { runThreeRuntimeTests } from "./three-runtime.test.js";

runCharacterControllerTests();
runCharacterAnimationGraphTests();
runCharacterAnimationBindingTests();
runCharacterAnimationRuntimeApplierTests();
runInteractionCoordinatorTests();
runNavigationWorldCoordinatorTests();
runRootMotionAuthorityTests();
await runCoreDataTests();
await runMotionRuntimeTests();
await runRetargetingIkFacialTests();
await runThreeRuntimeTests();

console.log("waifu-animation tests passed");
