export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface Matrix2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export type Segment = LineSegment | CubicBezierSegment | ArcSegment;

export interface LineSegment {
  readonly kind: "line";
  readonly from: Point;
  readonly to: Point;
}

export interface CubicBezierSegment {
  readonly kind: "bezier";
  readonly from: Point;
  readonly cp1: Point;
  readonly cp2: Point;
  readonly to: Point;
}

export interface ArcSegment {
  readonly kind: "arc";
  readonly center: Point;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly counterclockwise: boolean;
}

export interface Subpath {
  readonly start: Point;
  readonly segments: readonly Segment[];
  readonly closed: boolean;
}

export interface PathGeometry {
  readonly subpaths: readonly Subpath[];
}

export interface PaintStyle {
  readonly fillStyle: string;
  readonly strokeStyle: string;
  readonly lineWidth: number;
}

export interface DrawOp {
  readonly opId: string;
  readonly paint: "fill" | "stroke";
  readonly path: PathGeometry;
  readonly style: PaintStyle;
}

export interface GeometryDocument {
  readonly version: 1;
  readonly drawOps: readonly DrawOp[];
}

export interface ClosestPointResult {
  readonly point: Point;
  readonly distance: number;
  readonly opId: string;
  readonly segmentKind: Segment["kind"];
}

export interface AnchorCandidate {
  readonly point: Point;
  readonly type: "vertex" | "arc-extreme";
  readonly opId: string;
}
