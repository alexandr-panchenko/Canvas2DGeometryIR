import type { Matrix2D, Point, Rect } from "./types";

export const EPSILON = 1e-9;

export const identityMatrix = (): Matrix2D => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export const multiplyMatrix = (lhs: Matrix2D, rhs: Matrix2D): Matrix2D => ({
  a: lhs.a * rhs.a + lhs.c * rhs.b,
  b: lhs.b * rhs.a + lhs.d * rhs.b,
  c: lhs.a * rhs.c + lhs.c * rhs.d,
  d: lhs.b * rhs.c + lhs.d * rhs.d,
  e: lhs.a * rhs.e + lhs.c * rhs.f + lhs.e,
  f: lhs.b * rhs.e + lhs.d * rhs.f + lhs.f,
});

export const applyMatrix = (matrix: Matrix2D, p: Point): Point => ({
  x: matrix.a * p.x + matrix.c * p.y + matrix.e,
  y: matrix.b * p.x + matrix.d * p.y + matrix.f,
});

export const translationMatrix = (tx: number, ty: number): Matrix2D => ({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty });
export const scalingMatrix = (sx: number, sy: number): Matrix2D => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
export const rotationMatrix = (radians: number): Matrix2D => {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
};

export const rectFromPoint = (point: Point): Rect => ({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y });

export const expandRectWithPoint = (rect: Rect, point: Point): Rect => ({
  minX: Math.min(rect.minX, point.x),
  minY: Math.min(rect.minY, point.y),
  maxX: Math.max(rect.maxX, point.x),
  maxY: Math.max(rect.maxY, point.y),
});

export const mergeRects = (lhs: Rect, rhs: Rect): Rect => ({
  minX: Math.min(lhs.minX, rhs.minX),
  minY: Math.min(lhs.minY, rhs.minY),
  maxX: Math.max(lhs.maxX, rhs.maxX),
  maxY: Math.max(lhs.maxY, rhs.maxY),
});

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

export const lerpPoint = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
