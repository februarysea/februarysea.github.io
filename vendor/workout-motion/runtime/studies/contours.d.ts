export interface Point2 {
    x: number;
    y: number;
}
/**
 * Flatten the M/L/C/Q/Z paths emitted by our body-contour helpers. Each move
 * starts a separate polyline; only Z closes it. This is deliberately not a
 * general SVG parser (arcs, shorthand curves and transforms are not supported).
 */
export declare function flattenPath(d: string): Point2[][];
/** Filled simple polygon containment, including its boundary. */
export declare function pointInPolygon(point: Point2, polygon: Point2[]): boolean;
/**
 * Keep only stroke portions outside a union of filled polygons. Half-pixel
 * sampling finds contour crossings, and bisection places the new ends without
 * screen-bound assumptions. Bounding boxes reject unrelated surfaces before
 * containment checks. Samples locate crossings but do not add redundant output
 * vertices: only original flattened vertices and clipping endpoints are emitted.
 */
export declare function clipLineOutside(d: string, occluders: Point2[][], keepInside?: boolean): string;
/** Keep a muscle detail within the surface that owns it. */
export declare function clipLineInside(d: string, boundary: Point2[][]): string;
