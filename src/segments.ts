import { clamp01, distance, expandRectWithPoint, lerpPoint, rectFromPoint, EPSILON } from "./math";
import type { AnchorCandidate, ArcSegment, ClosestPointResult, Point, Rect, Segment } from "./types";

export const segmentStart = (segment: Segment): Point => {
  switch (segment.kind) {
    case "line":
    case "bezier":
      return segment.from;
    case "arc":
      return {
        x: segment.center.x + Math.cos(segment.startAngle) * segment.radius,
        y: segment.center.y + Math.sin(segment.startAngle) * segment.radius,
      };
  }
};

export const segmentEnd = (segment: Segment): Point => {
  switch (segment.kind) {
    case "line":
    case "bezier":
      return segment.to;
    case "arc":
      return {
        x: segment.center.x + Math.cos(segment.endAngle) * segment.radius,
        y: segment.center.y + Math.sin(segment.endAngle) * segment.radius,
      };
  }
};

const cubicPoint = (from: Point, cp1: Point, cp2: Point, to: Point, t: number): Point => {
  const p01 = lerpPoint(from, cp1, t);
  const p12 = lerpPoint(cp1, cp2, t);
  const p23 = lerpPoint(cp2, to, t);
  const p012 = lerpPoint(p01, p12, t);
  const p123 = lerpPoint(p12, p23, t);
  return lerpPoint(p012, p123, t);
};

const normalizeArcAngles = (segment: ArcSegment): { start: number; end: number } => {
  let { startAngle: start, endAngle: end } = segment;
  if (!segment.counterclockwise && end < start) {
    end += Math.PI * 2;
  }
  if (segment.counterclockwise && end > start) {
    start += Math.PI * 2;
  }
  return { start, end };
};

const inArcSweep = (angle: number, segment: ArcSegment): boolean => {
  const { start, end } = normalizeArcAngles(segment);
  if (!segment.counterclockwise) {
    const normalizedAngle = angle < start ? angle + Math.PI * 2 : angle;
    return normalizedAngle >= start - EPSILON && normalizedAngle <= end + EPSILON;
  }
  const normalizedAngle = angle > start ? angle - Math.PI * 2 : angle;
  return normalizedAngle <= start + EPSILON && normalizedAngle >= end - EPSILON;
};

export const flattenSegment = (segment: Segment, tolerance = 0.5): Point[] => {
  switch (segment.kind) {
    case "line":
      return [segment.from, segment.to];
    case "bezier": {
      const chord = distance(segment.from, segment.to);
      const steps = Math.max(12, Math.ceil(chord / Math.max(tolerance, 0.1)));
      const points: Point[] = [];
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        points.push(cubicPoint(segment.from, segment.cp1, segment.cp2, segment.to, t));
      }
      return points;
    }
    case "arc": {
      const { start, end } = normalizeArcAngles(segment);
      const span = Math.abs(end - start);
      const steps = Math.max(8, Math.ceil(span / (Math.PI / 18)));
      const points: Point[] = [];
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const theta = segment.counterclockwise ? start - span * t : start + span * t;
        points.push({
          x: segment.center.x + Math.cos(theta) * segment.radius,
          y: segment.center.y + Math.sin(theta) * segment.radius,
        });
      }
      return points;
    }
  }
};

export const segmentBounds = (segment: Segment): Rect => {
  const points = flattenSegment(segment, 0.25);
  let rect = rectFromPoint(points[0]!);
  for (const point of points.slice(1)) {
    rect = expandRectWithPoint(rect, point);
  }
  return rect;
};

const closestPointOnLine = (from: Point, to: Point, p: Point): Point => {
  const vx = to.x - from.x;
  const vy = to.y - from.y;
  const denom = vx * vx + vy * vy;
  if (denom <= EPSILON) {
    return from;
  }
  const t = clamp01(((p.x - from.x) * vx + (p.y - from.y) * vy) / denom);
  return { x: from.x + t * vx, y: from.y + t * vy };
};

export const closestPointOnSegment = (segment: Segment, p: Point): Point => {
  if (segment.kind === "line") {
    return closestPointOnLine(segment.from, segment.to, p);
  }
  const points = flattenSegment(segment, 0.25);
  let best = points[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i += 1) {
    const candidate = closestPointOnLine(points[i - 1]!, points[i]!, p);
    const d = distance(candidate, p);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best;
};

export const segmentAnchors = (segment: Segment): Point[] => {
  const start = segmentStart(segment);
  const end = segmentEnd(segment);
  if (segment.kind !== "arc") {
    return [start, end];
  }
  const anchors = [start, end];
  for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    if (inArcSweep(angle, segment)) {
      anchors.push({
        x: segment.center.x + Math.cos(angle) * segment.radius,
        y: segment.center.y + Math.sin(angle) * segment.radius,
      });
    }
  }
  return anchors;
};

export const anchorCandidatesFromSegment = (segment: Segment, opId: string): AnchorCandidate[] =>
  segmentAnchors(segment).map((point, index) => ({
    point,
    type: index < 2 ? "vertex" : "arc-extreme",
    opId,
  }));

export const closestResultFromSegment = (segment: Segment, p: Point, opId: string): ClosestPointResult => {
  const point = closestPointOnSegment(segment, p);
  return { point, distance: distance(point, p), opId, segmentKind: segment.kind };
};
