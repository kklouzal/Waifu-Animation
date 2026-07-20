import { runCharacterAnimationGraphTests } from "./character-animation-graph.test.js";
import { runCharacterControllerTests } from "./character-controller.test.js";
import { runCoreDataTests } from "./core-data.test.js";
import { runMotionRuntimeTests } from "./motion-runtime.test.js";
import { runRetargetingIkFacialTests } from "./retargeting-ik-facial.test.js";
import { runThreeRuntimeTests } from "./three-runtime.test.js";

runCharacterControllerTests();
runCharacterAnimationGraphTests();
await runCoreDataTests();
await runMotionRuntimeTests();
await runRetargetingIkFacialTests();
await runThreeRuntimeTests();

console.log("waifu-animation tests passed");
