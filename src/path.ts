import { expandRectWithPoint, mergeRects, rectFromPoint } from "./math";
import { flattenSegment, segmentBounds, segmentEnd, segmentStart } from "./segments";
import type { PathGeometry, Point, Rect, Segment, Subpath } from "./types";

export class PathBuilder {
  private subpaths: Subpath[] = [];
  private currentStart: Point | null = null;
  private currentPoint: Point | null = null;
  private currentSegments: Segment[] = [];

  beginPath(): void {
    this.subpaths = [];
    this.currentStart = null;
    this.currentPoint = null;
    this.currentSegments = [];
  }

  moveTo(point: Point): void {
    this.flushCurrentSubpath(false);
    this.currentStart = point;
    this.currentPoint = point;
    this.currentSegments = [];
  }

  addSegment(segment: Segment): void {
    if (this.currentStart === null || this.currentPoint === null) {
      this.moveTo(segmentStart(segment));
    }
    this.currentSegments.push(segment);
    this.currentPoint = segmentEnd(segment);
  }

  closePath(): void {
    if (this.currentStart === null || this.currentPoint === null) {
      return;
    }
    if (this.currentSegments.length > 0) {
      const end = this.currentPoint;
      if (end.x !== this.currentStart.x || end.y !== this.currentStart.y) {
        this.currentSegments.push({ kind: "line", from: end, to: this.currentStart });
      }
    }
    this.flushCurrentSubpath(true);
  }

  snapshotPath(): PathGeometry {
    const subpaths = [...this.subpaths];
    if (this.currentStart !== null) {
      subpaths.push({
        start: this.currentStart,
        segments: [...this.currentSegments],
        closed: false,
      });
    }
    return { subpaths };
  }

  isEmpty(): boolean {
    const active = this.currentSegments.length;
    if (active > 0) return false;
    return this.subpaths.every((subpath) => subpath.segments.length === 0);
  }

  private flushCurrentSubpath(closed: boolean): void {
    if (this.currentStart === null) return;
    this.subpaths.push({
      start: this.currentStart,
      segments: [...this.currentSegments],
      closed,
    });
    this.currentStart = null;
    this.currentPoint = null;
    this.currentSegments = [];
  }
}

export const pathBounds = (path: PathGeometry): Rect | null => {
  let rect: Rect | null = null;
  for (const subpath of path.subpaths) {
    if (subpath.segments.length === 0) {
      rect = rect === null ? rectFromPoint(subpath.start) : expandRectWithPoint(rect, subpath.start);
      continue;
    }
    for (const segment of subpath.segments) {
      const segmentRect = segmentBounds(segment);
      rect = rect === null ? segmentRect : mergeRects(rect, segmentRect);
    }
  }
  return rect;
};

export const flattenSubpathBoundary = (subpath: Subpath, tolerance = 0.5): Point[] => {
  if (subpath.segments.length === 0) {
    return [subpath.start];
  }
  const points: Point[] = [];
  for (const segment of subpath.segments) {
    const flattened = flattenSegment(segment, tolerance);
    if (points.length === 0) {
      points.push(...flattened);
    } else {
      points.push(...flattened.slice(1));
    }
  }
  return points;
};
