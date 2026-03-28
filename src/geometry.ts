import { distance, mergeRects } from "./math";
import { flattenSubpathBoundary, pathBounds } from "./path";
import { anchorCandidatesFromSegment, closestResultFromSegment } from "./segments";
import type { AnchorCandidate, ClosestPointResult, GeometryDocument, Point, Rect } from "./types";

const pointOnPolylineDistance = (polyline: readonly Point[], point: Point): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < polyline.length; i += 1) {
    const a = polyline[i - 1]!;
    const b = polyline[i]!;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const denom = vx * vx + vy * vy;
    const t = denom === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * vx + (point.y - a.y) * vy) / denom));
    const projection = { x: a.x + vx * t, y: a.y + vy * t };
    best = Math.min(best, distance(projection, point));
  }
  return best;
};

const isPointInPolygon = (polygon: readonly Point[], point: Point): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersect =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y + Number.EPSILON) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
};

const intersectLineSegments = (a1: Point, a2: Point, b1: Point, b2: Point): Point | null => {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(d) < 1e-8) return null;
  const u = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  const v = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { x: a1.x + u * (a2.x - a1.x), y: a1.y + u * (a2.y - a1.y) };
};

export class GeometryEngine {
  constructor(private readonly document: GeometryDocument) {}

  getBounds(): Rect | null {
    let total: Rect | null = null;
    for (const op of this.document.drawOps) {
      const bounds = pathBounds(op.path);
      if (bounds === null) continue;
      total = total === null ? bounds : mergeRects(total, bounds);
    }
    return total;
  }

  hitTestPoint(point: Point): { opId: string; paint: "fill" | "stroke" }[] {
    const hits: { opId: string; paint: "fill" | "stroke" }[] = [];
    for (const op of this.document.drawOps) {
      if (op.paint === "fill") {
        const fillHit = op.path.subpaths.some((subpath) => {
          if (subpath.segments.length === 0) return false;
          const polygon = flattenSubpathBoundary(subpath, 0.5);
          return isPointInPolygon(polygon, point);
        });
        if (fillHit) hits.push({ opId: op.opId, paint: op.paint });
      } else {
        const strokeHit = op.path.subpaths.some((subpath) => {
          const polyline = flattenSubpathBoundary(subpath, 0.5);
          return pointOnPolylineDistance(polyline, point) <= op.style.lineWidth / 2;
        });
        if (strokeHit) hits.push({ opId: op.opId, paint: op.paint });
      }
    }
    return hits;
  }

  getPathIntersections(opIdA: string, opIdB: string): Point[] {
    const a = this.document.drawOps.find((op) => op.opId === opIdA);
    const b = this.document.drawOps.find((op) => op.opId === opIdB);
    if (!a || !b) return [];
    const intersections: Point[] = [];
    for (const sa of a.path.subpaths) {
      const pa = flattenSubpathBoundary(sa, 0.5);
      for (const sb of b.path.subpaths) {
        const pb = flattenSubpathBoundary(sb, 0.5);
        for (let i = 1; i < pa.length; i += 1) {
          for (let j = 1; j < pb.length; j += 1) {
            const intersection = intersectLineSegments(pa[i - 1]!, pa[i]!, pb[j - 1]!, pb[j]!);
            if (intersection !== null) {
              intersections.push(intersection);
            }
          }
        }
      }
    }
    return intersections;
  }

  closestPoint(point: Point): ClosestPointResult | null {
    let best: ClosestPointResult | null = null;
    for (const op of this.document.drawOps) {
      for (const subpath of op.path.subpaths) {
        for (const segment of subpath.segments) {
          const result = closestResultFromSegment(segment, point, op.opId);
          if (best === null || result.distance < best.distance) {
            best = result;
          }
        }
      }
    }
    return best;
  }

  getAnchorCandidates(): AnchorCandidate[] {
    const anchors: AnchorCandidate[] = [];
    for (const op of this.document.drawOps) {
      for (const subpath of op.path.subpaths) {
        for (const segment of subpath.segments) {
          anchors.push(...anchorCandidatesFromSegment(segment, op.opId));
        }
      }
    }
    return anchors;
  }

  inspectPath(opId: string): { segmentKinds: string[]; subpathCount: number } | null {
    const op = this.document.drawOps.find((entry) => entry.opId === opId);
    if (!op) return null;
    const segmentKinds: string[] = [];
    for (const subpath of op.path.subpaths) {
      for (const segment of subpath.segments) {
        segmentKinds.push(segment.kind);
      }
    }
    return { segmentKinds, subpathCount: op.path.subpaths.length };
  }
}
