import type { StudyPose, Vec3 } from "./rig.js";
export interface GarmentRing {
    center: Vec3;
    /** Across the fabric cross-section; always points toward the body's right. */
    side: Vec3;
    /** Forward face of the fabric cross-section. */
    front: Vec3;
    rx: number;
    rz: number;
}
export interface ShortsSleeve {
    name: "left" | "right";
    /** Hip-to-knee direction; the hem lies in the plane perpendicular to it. */
    axis: Vec3;
    side: Vec3;
    front: Vec3;
    rings: GarmentRing[];
    hem: GarmentRing;
    /** Outer seam follows the thigh, including at the deepest squat position. */
    outerSeam: Vec3[];
}
export interface GarmentGeometry {
    /** Continuous deep hip-hinge correction; zero for the three visual benchmarks. */
    hingeBlend: number;
    waistband: [GarmentRing, GarmentRing];
    pelvis: GarmentRing[];
    legs: [ShortsSleeve, ShortsSleeve];
    /** A surface seam landmark, not a point fixed below the torso. */
    crotch: Vec3;
}
/** Sample a physical ring; renderers can select its visible arc by camera depth. */
export declare function garmentRingPoint(ring: GarmentRing, angle: number): Vec3;
export declare function garmentRingPoints(ring: GarmentRing, count?: number): Vec3[];
/**
 * A small pelvis yoke and two separate, femur-skinned fabric sleeves. The old
 * flat outline moved each hem's centre but kept its edge and crotch in the torso
 * frame. At deep flexion that left the shorts hanging vertically over horizontal
 * thighs. Here every sleeve section and seam rotates with its own femur.
 *
 * The proximal rings overlap the pelvis yoke, which should be drawn over their
 * tops without an internal joining stroke. It is one continuous garment surface,
 * not two visible capped cylinders. Only the distal ring is a visible hem.
 */
export declare function garmentGeometry(pose: StudyPose): GarmentGeometry;
