import { applyMatrix, identityMatrix, multiplyMatrix, rotationMatrix, scalingMatrix, translationMatrix, EPSILON } from "./math";
import { PathBuilder } from "./path";
import type { DrawOp, GeometryDocument, Matrix2D, PaintStyle, Point } from "./types";

interface ContextState {
  readonly matrix: Matrix2D;
  readonly style: PaintStyle;
}

const defaultStyle = (): PaintStyle => ({
  fillStyle: "#000000",
  strokeStyle: "#000000",
  lineWidth: 1,
  lineDash: [],
  lineCap: "butt",
  lineJoin: "miter",
  miterLimit: 10,
  fillOpacity: 1,
  strokeOpacity: 1,
});

const isCirclePreservingTransform = (matrix: Matrix2D): boolean => {
  const column1Length = Math.hypot(matrix.a, matrix.b);
  const column2Length = Math.hypot(matrix.c, matrix.d);
  const dot = matrix.a * matrix.c + matrix.b * matrix.d;
  return Math.abs(column1Length - column2Length) <= 1e-6 && Math.abs(dot) <= 1e-6;
};

const normalizeArcSweep = (startAngle: number, endAngle: number, counterclockwise: boolean): { start: number; delta: number } => {
  const fullTurn = Math.PI * 2;
  let delta = endAngle - startAngle;
  if (!counterclockwise && delta < 0) {
    delta += fullTurn;
  }
  if (counterclockwise && delta > 0) {
    delta -= fullTurn;
  }
  if (Math.abs(delta) >= fullTurn - 1e-8) {
    delta = counterclockwise ? -fullTurn : fullTurn;
  }
  return { start: startAngle, delta };
};

const cubicArcSegments = (
  center: Point,
  radius: number,
  startAngle: number,
  endAngle: number,
  counterclockwise: boolean,
): Array<{ from: Point; cp1: Point; cp2: Point; to: Point }> => {
  const { start, delta } = normalizeArcSweep(startAngle, endAngle, counterclockwise);
  const segmentCount = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segmentCount;
  const segments: Array<{ from: Point; cp1: Point; cp2: Point; to: Point }> = [];

  for (let index = 0; index < segmentCount; index += 1) {
    const theta1 = start + step * index;
    const theta2 = theta1 + step;
    const alpha = (4 / 3) * Math.tan((theta2 - theta1) / 4);
    const cos1 = Math.cos(theta1);
    const sin1 = Math.sin(theta1);
    const cos2 = Math.cos(theta2);
    const sin2 = Math.sin(theta2);

    const from = { x: center.x + radius * cos1, y: center.y + radius * sin1 };
    const to = { x: center.x + radius * cos2, y: center.y + radius * sin2 };
    const cp1 = {
      x: from.x - radius * alpha * sin1,
      y: from.y + radius * alpha * cos1,
    };
    const cp2 = {
      x: to.x + radius * alpha * sin2,
      y: to.y - radius * alpha * cos2,
    };
    segments.push({ from, cp1, cp2, to });
  }

  return segments;
};

export class Canvas2DGeometryIRContext {
  private drawOps: DrawOp[] = [];
  private path = new PathBuilder();
  private currentPoint: Point | null = null;
  private state: ContextState = { matrix: identityMatrix(), style: defaultStyle() };
  private readonly stack: ContextState[] = [];
  private opIndex = 0;

  set fillStyle(value: string) {
    this.state = { ...this.state, style: { ...this.state.style, fillStyle: value } };
  }

  set strokeStyle(value: string) {
    this.state = { ...this.state, style: { ...this.state.style, strokeStyle: value } };
  }

  set lineWidth(value: number) {
    this.state = { ...this.state, style: { ...this.state.style, lineWidth: value } };
  }

  set lineDash(value: readonly number[]) {
    this.state = { ...this.state, style: { ...this.state.style, lineDash: [...value] } };
  }

  set lineCap(value: "butt" | "round" | "square") {
    this.state = { ...this.state, style: { ...this.state.style, lineCap: value } };
  }

  set lineJoin(value: "miter" | "round" | "bevel") {
    this.state = { ...this.state, style: { ...this.state.style, lineJoin: value } };
  }

  set miterLimit(value: number) {
    this.state = { ...this.state, style: { ...this.state.style, miterLimit: value } };
  }

  set fillOpacity(value: number) {
    this.state = { ...this.state, style: { ...this.state.style, fillOpacity: value } };
  }

  set strokeOpacity(value: number) {
    this.state = { ...this.state, style: { ...this.state.style, strokeOpacity: value } };
  }

  beginPath(): void {
    this.path.beginPath();
    this.currentPoint = null;
  }

  moveTo(x: number, y: number): void {
    const transformed = applyMatrix(this.state.matrix, { x, y });
    this.path.moveTo(transformed);
    this.currentPoint = transformed;
  }

  lineTo(x: number, y: number): void {
    const to = applyMatrix(this.state.matrix, { x, y });
    const from = this.currentPoint ?? to;
    this.path.addSegment({ kind: "line", from, to });
    this.currentPoint = to;
  }

  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    const from = this.currentPoint ?? applyMatrix(this.state.matrix, { x, y });
    const cp1 = applyMatrix(this.state.matrix, { x: cp1x, y: cp1y });
    const cp2 = applyMatrix(this.state.matrix, { x: cp2x, y: cp2y });
    const to = applyMatrix(this.state.matrix, { x, y });
    this.path.addSegment({ kind: "bezier", from, cp1, cp2, to });
    this.currentPoint = to;
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    const from = this.currentPoint ?? applyMatrix(this.state.matrix, { x, y });
    const cp = applyMatrix(this.state.matrix, { x: cpx, y: cpy });
    const to = applyMatrix(this.state.matrix, { x, y });
    const cp1 = { x: from.x + (2 / 3) * (cp.x - from.x), y: from.y + (2 / 3) * (cp.y - from.y) };
    const cp2 = { x: to.x + (2 / 3) * (cp.x - to.x), y: to.y + (2 / 3) * (cp.y - to.y) };
    this.path.addSegment({ kind: "bezier", from, cp1, cp2, to });
    this.currentPoint = to;
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise = false): void {
    if (!isCirclePreservingTransform(this.state.matrix)) {
      const center = { x, y };
      const lowered = cubicArcSegments(center, radius, startAngle, endAngle, counterclockwise);
      if (lowered.length === 0) {
        return;
      }
      const startPoint = applyMatrix(this.state.matrix, lowered[0]!.from);
      if (this.currentPoint !== null && (Math.abs(this.currentPoint.x - startPoint.x) > EPSILON || Math.abs(this.currentPoint.y - startPoint.y) > EPSILON)) {
        this.path.addSegment({ kind: "line", from: this.currentPoint, to: startPoint });
      } else if (this.currentPoint === null) {
        this.path.moveTo(startPoint);
      }
      for (const segment of lowered) {
        this.path.addSegment({
          kind: "bezier",
          from: applyMatrix(this.state.matrix, segment.from),
          cp1: applyMatrix(this.state.matrix, segment.cp1),
          cp2: applyMatrix(this.state.matrix, segment.cp2),
          to: applyMatrix(this.state.matrix, segment.to),
        });
      }
      this.currentPoint = applyMatrix(this.state.matrix, lowered[lowered.length - 1]!.to);
      return;
    }

    const center = applyMatrix(this.state.matrix, { x, y });
    const sx = center.x + Math.cos(startAngle) * radius;
    const sy = center.y + Math.sin(startAngle) * radius;
    const startPoint = { x: sx, y: sy };
    if (this.currentPoint !== null && (this.currentPoint.x !== sx || this.currentPoint.y !== sy)) {
      this.path.addSegment({ kind: "line", from: this.currentPoint, to: startPoint });
    } else if (this.currentPoint === null) {
      this.path.moveTo(startPoint);
    }
    this.path.addSegment({
      kind: "arc",
      center,
      radius,
      startAngle,
      endAngle,
      counterclockwise,
    });
    this.currentPoint = { x: center.x + Math.cos(endAngle) * radius, y: center.y + Math.sin(endAngle) * radius };
  }

  closePath(): void {
    this.path.closePath();
    this.currentPoint = null;
  }

  fill(fillRule: DrawOp["fillRule"] = "nonzero"): void {
    this.commitPath("fill", fillRule);
  }

  stroke(): void {
    this.commitPath("stroke", "nonzero");
  }

  save(): void {
    this.stack.push({
      matrix: this.state.matrix,
      style: { ...this.state.style, lineDash: [...this.state.style.lineDash] },
    });
  }

  restore(): void {
    const previous = this.stack.pop();
    if (previous) this.state = previous;
  }

  translate(tx: number, ty: number): void {
    this.state = { ...this.state, matrix: multiplyMatrix(this.state.matrix, translationMatrix(tx, ty)) };
  }

  rotate(radians: number): void {
    this.state = { ...this.state, matrix: multiplyMatrix(this.state.matrix, rotationMatrix(radians)) };
  }

  scale(sx: number, sy: number): void {
    this.state = { ...this.state, matrix: multiplyMatrix(this.state.matrix, scalingMatrix(sx, sy)) };
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.state = { ...this.state, matrix: { a, b, c, d, e, f } };
  }

  resetTransform(): void {
    this.state = { ...this.state, matrix: identityMatrix() };
  }

  getDocument(): GeometryDocument {
    return {
      version: 1,
      drawOps: this.drawOps.map((op) => ({
        ...op,
        style: { ...op.style, lineDash: [...op.style.lineDash] },
      })),
    };
  }

  clear(): void {
    this.drawOps = [];
    this.beginPath();
    this.stack.length = 0;
    this.state = { matrix: identityMatrix(), style: defaultStyle() };
    this.opIndex = 0;
  }

  private commitPath(paint: DrawOp["paint"], fillRule: DrawOp["fillRule"]): void {
    if (this.path.isEmpty()) return;
    this.drawOps.push({
      opId: `op-${this.opIndex}`,
      paint,
      fillRule,
      path: this.path.snapshotPath(),
      style: { ...this.state.style, lineDash: [...this.state.style.lineDash] },
    });
    this.opIndex += 1;
  }
}
