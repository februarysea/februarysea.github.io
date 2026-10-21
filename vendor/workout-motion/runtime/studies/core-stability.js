import { coreStudy as study } from "./core-common.js";
import { add, mul, v } from "./rig.js";
import { cycle, SIDES, Y, Z } from "./expansion-common.js";
import { plankPose } from "./bodyweight-common.js";
import { coreHand, straightLeg, supineCore } from "./core-common.js";
import { applyTorsoCurve, torsoFrameAt } from "./torso-curve.js";
export const forearmPlank = study("forearm-plank", "Forearm Plank", "前臂平板支撑", "前臂与前脚掌固定支撑，胸廓、骨盆和双腿保持直线。", () => {
    const pose = plankPose(.361), j = pose.joints;
    for (const [side] of SIDES) {
        const shoulder = j[`${side}Shoulder`], elbow = add(shoulder, v(0, -.305, 0)), wrist = add(elbow, v(0, 0, .285));
        j[`${side}Elbow`] = elbow;
        j[`${side}Wrist`] = wrist;
        pose.handContacts[side] = { center: add(wrist, v(0, -.042, .050)), forward: Z, normal: Y };
    }
    pose.groundContacts = [v(-.29, 0, .61), v(.29, 0, .61), v(-.19, 0, -.83), v(.19, 0, -.83)];
    return pose;
}, [{ phase: 0, label: "前臂与前脚掌支撑" }], 4200, true);
export const hollowBodyHold = study("hollow-body-hold", "Hollow Body Hold", "船式空心支撑", "腰背稳定贴近地面，肩胛与伸直的双腿离地，双臂延伸过头。", () => {
    const pose = supineCore(), theta = -.20691745770;
    applyTorsoCurve(pose, { pelvisUp: v(0, Math.sin(theta), -Math.cos(theta)), flexion: .75 });
    const end = torsoFrameAt(pose, 1);
    for (const [side, sign] of SIDES) {
        straightLeg(pose, side, v(0, .28, Math.sqrt(1 - .28 ** 2)));
        const wrist = add(add(pose.joints[`${side}Shoulder`], mul(end.up, .572)), v(sign * .065, 0, 0));
        coreHand(pose, side, wrist, v(sign, .2, 0), end.up, end.front);
    }
    return pose;
}, [{ phase: 0, label: "腰背固定、四肢伸展保持" }], 4200, true);
export const deadBug = study("dead-bug", "Dead Bug", "死虫式", "腰背保持稳定，对侧手脚缓慢伸展并回到起点，再交替另一侧。", phase => {
    const t = ((phase % 1) + 1) % 1, a = cycle((t % .5) * 2), active = t < .5 ? "left" : "right";
    const pose = supineCore(), j = pose.joints;
    for (const [side, sign] of SIDES) {
        const legAmount = side === active ? a : 0, armAmount = side !== active ? a : 0;
        const thighAngle = 1.32 * legAmount, thigh = v(0, Math.cos(thighAngle), Math.sin(thighAngle));
        const knee = add(j[`${side}Hip`], mul(thigh, .445));
        const shinAngle = .18 * legAmount, shin = v(0, Math.sin(shinAngle), Math.cos(shinAngle));
        j[`${side}Knee`] = knee;
        const ankle = add(knee, mul(shin, .425));
        // Both segments remain anatomical lengths as the working knee opens.
        j[`${side}Ankle`] = ankle;
        j[`${side}Toe`] = add(ankle, v(0, .17, .045));
        (pose.footFrames ??= {})[side] = { forward: Y, normal: v(0, 0, -1) };
        const armAngle = 1.22 * armAmount, direction = v(0, Math.cos(armAngle), -Math.sin(armAngle));
        const wrist = add(j[`${side}Shoulder`], mul(direction, .585));
        coreHand(pose, side, wrist, v(sign, 0, 0), direction, v(sign, 0, 0));
    }
    return pose;
}, [{ phase: 0, label: "手臂上举、屈髋屈膝" }, { phase: .22, label: "左腿与右臂伸展" }, { phase: .5, label: "收回起始位" }, { phase: .72, label: "右腿与左臂伸展" }], 6200);
export const stabilityCoreStudies = [forearmPlank, hollowBodyHold, deadBug];
