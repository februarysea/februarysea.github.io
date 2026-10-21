import { add, bendJoint, blend, BODY, dot, mul, sub, unit, v } from "./rig.js";
import { arm, body, cycle, dumbbell, hold, pairWeights, seat, SIDES, stages, standing, study, Z } from "./expansion-common.js";
import { cupWeight } from "./expansion-push.js";
const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
function channel(phase, keys) {
    const t = ((phase % 1) + 1) % 1;
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1][0])
        i++;
    const [ta, a] = keys[i], [tb, b] = keys[i + 1];
    return a + (b - a) * smooth((t - ta) / (tb - ta));
}
const toe = (ankle, pitch = 0) => add(ankle, v(0, -.045 * Math.cos(pitch) + .17 * Math.sin(pitch), .17 * Math.cos(pitch) + .045 * Math.sin(pitch)));
/** Keep the distal sole anchored while the heel rotates upward. */
const pivot = (flat, pitch) => add(flat, v(0, -.19 * Math.sin(pitch) + .07 * Math.cos(pitch) - .07, .19 - .19 * Math.cos(pitch) - .07 * Math.sin(pitch)));
function balanceArms(joints) {
    for (const [side, sign] of SIDES)
        arm(joints, side, add(joints[`${side}Shoulder`], v(-sign * .11, -.16, .24)), v(sign, -1, 0));
}
export const gobletSquatStudy = study("goblet-squat", "Goblet Squat", "杯式深蹲", "双手托住竖直哑铃于胸前，脚掌固定，屈髋屈膝下蹲后站起", phase => {
    const a = cycle(phase), lean = .10 + .31 * a;
    const joints = body(v(0, .915 - .45 * a, -.18 * a), v(0, Math.cos(lean), Math.sin(lean)), [v(-.22, .07, 0), v(.22, .07, 0)]);
    for (const [side, sign] of SIDES) {
        const ankle = joints[`${side}Ankle`], hip = joints[`${side}Hip`];
        const forward = v(sign * Math.sin(.22), 0, Math.cos(.22));
        const normal = v(forward.z, 0, -forward.x);
        const offset = dot(sub(hip, ankle), normal);
        // Solve within the foot's vertical plane while retaining the 3D thigh length.
        joints[`${side}Knee`] = bendJoint(sub(hip, mul(normal, offset)), ankle, Math.sqrt(BODY.thigh ** 2 - offset ** 2), BODY.shin, forward);
        joints[`${side}Toe`] = add(add(ankle, mul(forward, .17)), v(0, -.045, 0));
    }
    const wrist = add(v(0, joints.rightShoulder.y, joints.rightShoulder.z), v(0, -.09, .25));
    for (const [side, sign] of SIDES)
        arm(joints, side, add(wrist, v(sign * .055, 0, 0)), v(sign * .3, -1, 0));
    return cupWeight({ joints, shorts: { hipFlexion: true }, camera: { yaw: 50, pitch: 10 } }, wrist);
}, stages("胸前托铃", "屈髋下蹲", "蹲底支撑"), 4000);
export const bulgarianSplitSquatStudy = study("bulgarian-split-squat", "Bulgarian Split Squat", "保加利亚分腿蹲", "前脚固定地面，后脚脚背沿凳面放平，下沉后以前腿站起", phase => {
    const a = cycle(phase), rear = v(.14, .4095263157894737, -.50), lean = .10 + .16 * a;
    const joints = body(v(-.025, .88 - .32 * a, .035 + .035 * a), v(0, Math.cos(lean), Math.sin(lean)), [v(-.14, .07, .30), rear]);
    joints.rightKnee = bendJoint(joints.rightHip, rear, BODY.thigh, BODY.shin, v(0, -1, 0));
    const forward = v(0, 0, -1), normal = v(0, -1, 0);
    joints.rightToe = add(add(rear, mul(forward, .17)), mul(normal, -.045));
    balanceArms(joints);
    return { joints, feet: "air", footFrames: { right: { forward, normal } }, exactSurfaceContours: true, shorts: { hipFlexion: true },
        apparatus: { pads: [{ id: "rear-foot-pad", center: v(0, .40, -.69), axis: Z, length: .30, width: .58, thickness: .07 }], rods: [
                { id: "support", a: v(0, .025, -.69), b: v(0, .33, -.69), radius: .028 },
                { id: "base", a: v(-.36, .025, -.69), b: v(.36, .025, -.69), radius: .027 },
            ] }, groundContacts: [v(-.14, 0, .30)], camera: { yaw: 67, pitch: 9, viewBox: "-5 45 370 310" } };
}, stages("后脚垫高", "分腿下沉", "前腿承重"), 4000);
export const forwardLungeStudy = study("forward-lunge", "Forward Lunge", "前跨弓步蹲", "右脚向前跨步并全掌承重，下沉后蹬回并腿站位", phase => {
    const stride = channel(phase, [[0, 0], [.22, 1], [.73, 1], [1, 0]]);
    const down = channel(phase, [[0, 0], [.22, .28], [.49, 1], [.73, .28], [1, 0]]);
    const lift = channel(phase, [[0, 0], [.10, .12], [.22, 0], [.73, 0], [.87, .12], [1, 0]]);
    const pitch = channel(phase, [[0, 0], [.16, .18], [.22, .12], [.29, 0], [.73, 0], [.84, -.10], [1, 0]]);
    const rearPitch = -.56 * stride, rear = pivot(v(-.14, .07, 0), rearPitch);
    const front = v(.14, .065 * Math.sin(pitch) + .07 * Math.cos(pitch) + lift, .65 * stride - .065 + .065 * Math.cos(pitch) - .07 * Math.sin(pitch));
    const lean = .06 + .10 * down;
    const joints = body(v(.02 * stride, .915 - .385 * down, .30 * stride), v(0, Math.cos(lean), Math.sin(lean)), [rear, front]);
    joints.leftToe = toe(rear, rearPitch);
    joints.rightToe = toe(front, pitch);
    balanceArms(joints);
    return { joints, feet: "air", footPitch: { left: rearPitch, right: pitch }, shorts: { hipFlexion: true }, groundContacts: [v(-.14, 0, 0), v(.14, 0, .65)], camera: { yaw: 68, pitch: 10, viewBox: "-20 40 370 310" } };
}, [{ phase: 0, label: "并腿站位" }, { phase: .12, label: "向前跨步" }, { phase: .49, label: "弓步下沉" }, { phase: .73, label: "前脚蹬回" }, { phase: .9, label: "收腿回位" }], 4600);
export const dumbbellRomanianDeadliftStudy = study("dumbbell-romanian-deadlift", "Dumbbell Romanian Deadlift", "哑铃罗马尼亚硬拉", "双脚固定，膝微屈，髋后移时哑铃沿腿侧下行，再伸髋站起", phase => {
    const a = cycle(phase), joints = standing(.925 - .15 * a, .05 + 1.10 * a, -.31 * a);
    for (const [side, sign] of SIDES) {
        const e = add(joints[`${side}Shoulder`], v(sign * .13, -Math.sqrt(BODY.upperArm ** 2 - .13 ** 2 - .035 ** 2), .035));
        joints[`${side}Elbow`] = e;
        joints[`${side}Wrist`] = add(e, v(0, -BODY.forearm, 0));
    }
    return pairWeights({ joints, shorts: { hipFlexion: true, anchoredWaist: true, continuousYoke: true }, localOcclusion: { hips: true }, camera: { yaw: 62, pitch: 10 } }, Z, .085);
}, stages("站姿持铃", "髋向后移", "小腿附近"), 4100);
export const singleLegRomanianDeadliftStudy = study("single-leg-romanian-deadlift", "Single-leg Romanian Deadlift", "单腿罗马尼亚硬拉", "左腿支撑、右手持铃，躯干前倾与右腿后伸同步，再回到平衡站姿", phase => {
    const a = cycle(phase), theta = .07 + 1.17 * a, hip = v(-.07 * a, .92 - .15 * a, -.08 * a);
    const legAngle = .32 + .92 * a;
    const rightHip = add(hip, v(.1, 0, 0)), knee = add(rightHip, v(0, -BODY.thigh * Math.cos(legAngle), -BODY.thigh * Math.sin(legAngle)));
    const rear = add(knee, v(0, -BODY.shin * Math.cos(legAngle - .10), -BODY.shin * Math.sin(legAngle - .10)));
    const joints = body(hip, v(0, Math.cos(theta), Math.sin(theta)), [v(-.14, .07, 0), rear]);
    joints.rightKnee = knee;
    joints.rightToe = toe(rear, -.55 * a);
    const e = add(joints.rightShoulder, v(.13, -Math.sqrt(BODY.upperArm ** 2 - .13 ** 2), 0));
    joints.rightElbow = e;
    joints.rightWrist = add(e, v(0, -BODY.forearm, 0));
    arm(joints, "left", add(joints.leftShoulder, v(-.22, -.48, .07)), v(-1, 0, .2));
    const h = hold(e, joints.rightWrist, Z);
    return { joints, feet: "air", footPitch: { right: -.55 * a }, handholds: { right: h }, dumbbells: [dumbbell("right", h.center, h.axis, .08)], shorts: { hipFlexion: true, anchoredWaist: true }, localOcclusion: { hips: true }, groundContacts: [v(-.14, 0, 0)], camera: { yaw: 69, pitch: 10, viewBox: "-5 35 380 320" } };
}, stages("单腿平衡", "屈髋后伸", "躯干前倾"), 4300);
function stepSwing(from, to, q) {
    if (to.y < from.y)
        return stepSwing(to, from, 1 - q);
    const t = smooth(q), point = blend(from, to, t ** 1.5);
    point.y = from.y + (to.y - from.y) * (1 - (1 - t) ** 2) + .16 * Math.sin(Math.PI * q) ** 2;
    return point;
}
export const stepUpStudy = study("step-up", "Step-up", "上台阶", "左脚先踏稳台面，再伸腿站起并收右脚；右脚先退回地面", phase => {
    const t = ((phase % 1) + 1) % 1;
    const ground = [v(-.15, .07, 0), v(.15, .07, 0)], top = [v(-.15, .37, .48), v(.15, .37, .48)];
    let hips, ankles;
    const start = v(0, .915, 0), transfer = v(0, .85, .12), finish = v(0, 1.20, .48);
    if (t < .20) {
        const q = t / .20;
        hips = blend(start, transfer, smooth(q));
        ankles = [stepSwing(ground[0], top[0], q), ground[1]];
    }
    else if (t < .46) {
        const q = (t - .20) / .26;
        hips = blend(transfer, finish, smooth(q));
        ankles = [top[0], stepSwing(ground[1], top[1], q)];
    }
    else if (t < .55) {
        hips = finish;
        ankles = top;
    }
    else if (t < .80) {
        const q = (t - .55) / .25;
        hips = blend(finish, transfer, smooth(q));
        ankles = [top[0], stepSwing(top[1], ground[1], q)];
    }
    else {
        const q = (t - .80) / .20;
        hips = blend(transfer, start, smooth(q));
        ankles = [stepSwing(top[0], ground[0], q), ground[1]];
    }
    const lean = .05 + .13 * (1 - smooth((hips.y - .85) / .35));
    const joints = body(hips, v(0, Math.cos(lean), Math.sin(lean)), ankles);
    balanceArms(joints);
    return { joints, feet: "air", shorts: { hipFlexion: true }, boxes: [{ id: "step", center: v(0, 0, .60), width: .76, depth: .60, height: .30 }], groundContacts: [v(-.15, 0, 0), v(.15, 0, 0)], camera: { yaw: 61, pitch: 12, viewBox: "-30 30 370 325" } };
}, [{ phase: 0, label: "台前站位" }, { phase: .20, label: "左脚踏稳" }, { phase: .49, label: "台面站立" }, { phase: .80, label: "右脚退下" }, { phase: .91, label: "左脚收回" }], 5400);
export const standingCalfRaiseStudy = study("standing-calf-raise", "Standing Calf Raise", "站姿提踵", "前掌始终着地，膝近伸直，脚跟缓慢抬起再落回地面", phase => {
    const pitch = -.52 * cycle(phase), left = pivot(v(-.17, .07, 0), pitch), right = pivot(v(.17, .07, 0), pitch);
    const joints = body(v(0, .925 + left.y - .07, left.z), v(0, 1, 0), [left, right]);
    joints.leftToe = toe(left, pitch);
    joints.rightToe = toe(right, pitch);
    return { joints, feet: "air", footPitch: { left: pitch, right: pitch }, groundContacts: [v(-.17, 0, .19), v(.17, 0, .19)], camera: { yaw: 69, pitch: 10 } };
}, stages("全掌站立", "前掌推地", "脚跟抬起"), 3400);
export const seatedCalfRaiseStudy = study("seated-calf-raise", "Seated Calf Raise", "坐姿提踵", "哑铃置于膝上方并用手稳定，前掌固定，抬跟带动膝与负重升降", phase => {
    const pitch = -.52 * cycle(phase), left = pivot(v(-.17, .07, .44), pitch), right = pivot(v(.17, .07, .44), pitch);
    const joints = body(v(0, .56, 0), v(0, Math.cos(.32), Math.sin(.32)), [left, right], v(0, 1, .2));
    joints.leftToe = toe(left, pitch);
    joints.rightToe = toe(right, pitch);
    const hands = {}, weights = [];
    for (const [side] of SIDES) {
        const contact = add(joints[`${side}Knee`], v(0, .125, -.045));
        const elbow = bendJoint(joints[`${side}Shoulder`], contact, BODY.upperArm, BODY.forearm + .05, v(side === "left" ? -1 : 1, -.5, 0));
        joints[`${side}Elbow`] = elbow;
        joints[`${side}Wrist`] = add(contact, mul(unit(sub(elbow, contact)), .05));
        hands[side] = { center: contact, axis: Z, grip: "neutral" };
        weights.push(dumbbell(side, contact, Z, .08));
    }
    return { joints, feet: "air", footPitch: { left: pitch, right: pitch }, handholds: hands, dumbbells: weights, apparatus: seat(.455), shorts: { hipFlexion: true }, camera: { yaw: 62, pitch: 12, viewBox: "25 110 310 240" } };
}, stages("屈膝托铃", "前掌推地", "膝部抬起"), 3400);
export const lowerExpansionStudies = [gobletSquatStudy, bulgarianSplitSquatStudy, forwardLungeStudy, dumbbellRomanianDeadliftStudy, singleLegRomanianDeadliftStudy, stepUpStudy, standingCalfRaiseStudy, seatedCalfRaiseStudy];
