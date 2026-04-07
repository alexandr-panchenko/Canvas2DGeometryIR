import { distance, expandRect, mergeRects, rectContainsPoint, rectContainsRect, rectIntersectsRect } from "./math";
import { flattenSubpathBoundary, pathBounds } from "./path";
import { anchorCandidatesFromSegment, closestResultFromSegment } from "./segments";
import type { AnchorCandidate, ClosestPointResult, GeometryDocument, Point, Rect, RectQueryResult } from "./types";

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

const windingContribution = (a: Point, b: Point, point: Point): number => {
  if (a.y <= point.y) {
    if (b.y > point.y && (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) > 0) {
      return 1;
    }
    return 0;
  }
  if (b.y <= point.y && (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) < 0) {
    return -1;
  }
  return 0;
};

const pointInFilledPath = (
  path: GeometryDocument["drawOps"][number]["path"],
  fillRule: "nonzero" | "evenodd",
  point: Point,
): boolean => {
  if (fillRule === "evenodd") {
    let inside = false;
    for (const subpath of path.subpaths) {
      if (subpath.segments.length === 0) continue;
      const polygon = flattenSubpathBoundary(subpath, 0.5);
      if (isPointInPolygon(polygon, point)) {
        inside = !inside;
      }
    }
    return inside;
  }

  let winding = 0;
  for (const subpath of path.subpaths) {
    if (subpath.segments.length === 0) continue;
    const polygon = flattenSubpathBoundary(subpath, 0.5);
    for (let i = 1; i < polygon.length; i += 1) {
      winding += windingContribution(polygon[i - 1]!, polygon[i]!, point);
    }
  }
  return winding !== 0;
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

  getGeometryBounds(): Rect | null {
    let total: Rect | null = null;
    for (const op of this.document.drawOps) {
      const bounds = pathBounds(op.path);
      if (bounds === null) continue;
      total = total === null ? bounds : mergeRects(total, bounds);
    }
    return total;
  }

  getPaintBounds(): Rect | null {
    let total: Rect | null = null;
    for (const op of this.document.drawOps) {
      const bounds = pathBounds(op.path);
      if (bounds === null) continue;
      const paintBounds = op.paint === "stroke" ? expandRect(bounds, op.style.lineWidth / 2) : bounds;
      total = total === null ? paintBounds : mergeRects(total, paintBounds);
    }
    return total;
  }

  getBounds(): Rect | null {
    return this.getPaintBounds();
  }

  hitTestPoint(point: Point): { opId: string; paint: "fill" | "stroke" }[] {
    const hits: { opId: string; paint: "fill" | "stroke" }[] = [];
    for (const op of this.document.drawOps) {
      if (op.paint === "fill") {
        const fillHit = pointInFilledPath(op.path, op.fillRule, point);
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

  queryRect(rect: Rect): RectQueryResult[] {
    const rectCorners = [
      { x: rect.minX, y: rect.minY },
      { x: rect.maxX, y: rect.minY },
      { x: rect.maxX, y: rect.maxY },
      { x: rect.minX, y: rect.maxY },
    ];
    const rectEdges = [
      [rectCorners[0]!, rectCorners[1]!],
      [rectCorners[1]!, rectCorners[2]!],
      [rectCorners[2]!, rectCorners[3]!],
      [rectCorners[3]!, rectCorners[0]!],
    ] as const;

    return this.document.drawOps.flatMap((op) => {
      const geometryBounds = pathBounds(op.path);
      if (geometryBounds === null) {
        return [];
      }
      const paintBounds = op.paint === "stroke" ? expandRect(geometryBounds, op.style.lineWidth / 2) : geometryBounds;
      if (!rectIntersectsRect(paintBounds, rect)) {
        return [];
      }

      let intersects = false;
      let containsRect = false;
      let enclosedByRect = rectContainsRect(rect, paintBounds);

      if (op.paint === "fill") {
        containsRect = rectCorners.every((corner) => pointInFilledPath(op.path, op.fillRule, corner));
        intersects =
          containsRect ||
          rectCorners.some((corner) => pointInFilledPath(op.path, op.fillRule, corner)) ||
          op.path.subpaths.some((subpath) => {
            const polyline = flattenSubpathBoundary(subpath, 0.5);
            return polyline.some((point) => rectContainsPoint(rect, point));
          });
      } else {
        intersects = op.path.subpaths.some((subpath) => {
          const polyline = flattenSubpathBoundary(subpath, 0.5);
          if (polyline.some((point) => rectContainsPoint(rect, point))) {
            return true;
          }
          for (let i = 1; i < polyline.length; i += 1) {
            for (const edge of rectEdges) {
              if (intersectLineSegments(polyline[i - 1]!, polyline[i]!, edge[0], edge[1]) !== null) {
                return true;
              }
            }
          }
          return false;
        });
      }

      if (!intersects && !containsRect && !enclosedByRect) {
        return [];
      }

      return [{ opId: op.opId, paint: op.paint, intersects, containsRect, enclosedByRect }];
    });
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
