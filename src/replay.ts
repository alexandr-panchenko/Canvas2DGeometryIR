import type { DrawOp, GeometryDocument, Segment } from "./types";

export interface CanvasLikeReplayTarget {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  setFillStyle(value: string): void;
  setStrokeStyle(value: string): void;
  setLineWidth(value: number): void;
}

const replaySegment = (segment: Segment, target: CanvasLikeReplayTarget): void => {
  if (segment.kind === "line") {
    target.lineTo(segment.to.x, segment.to.y);
    return;
  }
  if (segment.kind === "bezier") {
    target.bezierCurveTo(segment.cp1.x, segment.cp1.y, segment.cp2.x, segment.cp2.y, segment.to.x, segment.to.y);
    return;
  }
  target.arc(
    segment.center.x,
    segment.center.y,
    segment.radius,
    segment.startAngle,
    segment.endAngle,
    segment.counterclockwise,
  );
};

export const replayDrawOp = (drawOp: DrawOp, target: CanvasLikeReplayTarget): void => {
  target.setFillStyle(drawOp.style.fillStyle);
  target.setStrokeStyle(drawOp.style.strokeStyle);
  target.setLineWidth(drawOp.style.lineWidth);
  target.beginPath();

  for (const subpath of drawOp.path.subpaths) {
    target.moveTo(subpath.start.x, subpath.start.y);
    for (const segment of subpath.segments) {
      replaySegment(segment, target);
    }
    if (subpath.closed) {
      target.closePath();
    }
  }

  if (drawOp.paint === "fill") {
    target.fill();
  } else {
    target.stroke();
  }
};

export const replayDocument = (document: GeometryDocument, target: CanvasLikeReplayTarget): void => {
  for (const drawOp of document.drawOps) {
    replayDrawOp(drawOp, target);
  }
};
