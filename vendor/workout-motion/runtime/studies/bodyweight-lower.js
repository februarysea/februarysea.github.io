import { add, bendJoint, BODY, dot, mul, sub, v } from "./rig.js";
import { arm, cycle, SIDES, stages, study } from "./expansion-common.js";
import { floorBody, foot } from "./bodyweight-common.js";
export const bodyweightSquatStudy = study("bodyweight-squat", "Bodyweight Squat", "徒手深蹲", "双脚固定、膝盖跟随脚尖，双臂前伸平衡，屈髋屈膝后站起", phase => {
    const a = cycle(phase), lean = .08 + .35 * a, pose = floorBody(v(0, .915 - .45 * a, -.18 * a), v(0, Math.cos(lean), Math.sin(lean))), j = pose.joints;
    for (const [side, sign] of SIDES) {
        const ankle = v(sign * .22, .07, 0), forward = v(sign * Math.sin(.22), 0, Math.cos(.22)), normal = v(forward.z, 0, -forward.x), hip = j[`${side}Hip`], offset = dot(sub(hip, ankle), normal);
        foot(pose, side, ankle, forward);
        j[`${side}Knee`] = bendJoint(sub(hip, mul(normal, offset)), ankle, Math.sqrt(BODY.thigh ** 2 - offset ** 2), BODY.shin, forward);
        arm(j, side, add(j[`${side}Shoulder`], v(sign * .01, -.14, .56)), v(sign * .2, -.5, .2));
    }
    pose.camera = { yaw: 49, pitch: 10, viewBox: "0 15 360 340" };
    return pose;
}, stages("站立前伸双臂", "屈髋下蹲", "膝盖跟随脚尖"), 3800);
export const lowerBodyweightStudies = [bodyweightSquatStudy];
