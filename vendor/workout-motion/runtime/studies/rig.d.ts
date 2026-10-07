export interface Vec3 {
    x: number;
    y: number;
    z: number;
}
export declare const v: (x: number, y: number, z: number) => Vec3;
export declare const add: (a: Vec3, b: Vec3) => Vec3;
export declare const sub: (a: Vec3, b: Vec3) => Vec3;
export declare const mul: (a: Vec3, scale: number) => Vec3;
export declare const dot: (a: Vec3, b: Vec3) => number;
export declare const length: (a: Vec3) => number;
export declare const unit: (a: Vec3) => Vec3;
export declare const cross: (a: Vec3, b: Vec3) => Vec3;
export declare const blend: (a: Vec3, b: Vec3, amount: number) => Vec3;
export declare const rep: (phase: number) => number;
export declare const BODY: Readonly<{
    upperArm: 0.305;
    forearm: 0.285;
    thigh: 0.445;
    shin: 0.425;
    torso: 0.49;
    shoulderHalf: 0.2;
    hipHalf: 0.1;
}>;
/** A fixed-length two-bone chain, bent toward a world-space direction. */
export declare function bendJoint(start: Vec3, end: Vec3, first: number, second: number, pole: Vec3): Vec3;
export type JointName = "head" | "neck" | "leftShoulder" | "rightShoulder" | "leftElbow" | "rightElbow" | "leftWrist" | "rightWrist" | "leftHip" | "rightHip" | "leftKnee" | "rightKnee" | "leftAnkle" | "rightAnkle" | "leftToe" | "rightToe";
export interface StudyPose {
    joints: Record<JointName, Vec3>;
    /** Shaft contacts; optional palmNormal points out of the palmar surface, not toward the wrist. */
    handholds?: Partial<Record<"left" | "right", {
        center: Vec3;
        axis: Vec3;
        grip?: "pronated" | "neutral";
        palmNormal?: Vec3;
    }>>;
    /** Palm volume center; forward points toward fingertips, normal away from support. */
    handContacts?: Partial<Record<"left" | "right", {
        center: Vec3;
        forward: Vec3;
        normal: Vec3;
    }>>;
    /** Opt-in readable surface detail for newly reviewed, foreshortened arm poses. */
    anatomy?: {
        surfaceArms?: boolean;
    };
    /** Refine local body/equipment overlap without changing accepted illustrations. */
    occlusion?: "surface";
    dumbbells?: readonly {
        id: string;
        center: Vec3;
        axis: Vec3;
        halfLength: number;
        plateRadius: number;
    }[];
    /** Sparse apparatus geometry; rods/cables split in depth by the renderer. */
    apparatus?: {
        rods?: readonly {
            id: string;
            a: Vec3;
            b: Vec3;
            radius?: number;
        }[];
        cables?: readonly {
            id: string;
            a: Vec3;
            b: Vec3;
        }[];
        /** Center is the top-surface center. Axis runs along the pad; width is world X. */
        pads?: readonly {
            id: string;
            center: Vec3;
            axis: Vec3;
            length: number;
            width: number;
            thickness: number;
        }[];
    };
    bar?: {
        center: Vec3;
        halfLength: number;
        plateRadius: number;
        support: "hands" | "upper-back";
        kind?: "barbell" | "pull-up-bar";
        grip?: "pronated" | "supinated";
        frontRack?: number;
        depthPolicy?: "physical";
    };
    landmine?: {
        pivot: Vec3;
        tip: Vec3;
        plateRadius: number;
        hand: "left" | "right";
    };
    /** Fixed apparatus, with center at the middle of its bottom face. */
    boxes?: readonly {
        id: string;
        center: Vec3;
        width: number;
        depth: number;
        height: number;
    }[];
    /** Optional bar contact separate from the wrist joint, e.g. a front-rack hand. */
    grips?: Partial<Record<"left" | "right", Vec3>>;
    /** Airborne shoes retain their ankle-relative height instead of reaching ground. */
    feet?: "flat" | "air";
    /** Optional ankle-relative shoe rotation in radians; positive lifts the toes. */
    footPitch?: Partial<Record<"left" | "right", number>>;
    /** Opt-in pelvis-to-thigh fabric transition for deeply flexed hip poses. */
    shorts?: {
        hipFlexion?: boolean;
    };
    /** Optional local floor marks beside separated support points, in world space. */
    groundContacts?: readonly Vec3[];
    camera?: {
        yaw: number;
        pitch?: number;
        viewBox?: string;
    };
    /** A bench along world Z, top surface at height. */
    bench?: {
        height: number;
        start: number;
        end: number;
        halfWidth: number;
    };
}
export interface MotionStudy {
    id: string;
    label: string;
    chinese: string;
    subtitle: string;
    durationMs: number;
    /** Named points for inspecting a multi-stage action without assuming .5 is its end. */
    keyframes?: readonly {
        phase: number;
        label: string;
    }[];
    pose: (phase: number) => StudyPose;
}
