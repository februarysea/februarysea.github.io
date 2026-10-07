import type { StudyPose } from "./rig.js";
export interface StudyPath {
    id: string;
    d: string;
    fill: string;
    stroke: string;
    width: number;
    depth: number;
}
export declare function drawStudy(pose: StudyPose): StudyPath[];
export type CharacterView = "front" | "three-quarter" | "side";
export declare function drawCharacter(view: CharacterView): StudyPath[];
export declare function pathsMarkup(parts: StudyPath[]): string;
