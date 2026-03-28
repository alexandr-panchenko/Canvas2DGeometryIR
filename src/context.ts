import { applyMatrix, identityMatrix, multiplyMatrix, rotationMatrix, scalingMatrix, translationMatrix } from "./math";
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
});

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

  fill(): void {
    this.commitPath("fill");
  }

  stroke(): void {
    this.commitPath("stroke");
  }

  save(): void {
    this.stack.push({ matrix: this.state.matrix, style: { ...this.state.style } });
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
      drawOps: this.drawOps.map((op) => ({ ...op, style: { ...op.style } })),
    };
  }

  clear(): void {
    this.drawOps = [];
    this.beginPath();
    this.stack.length = 0;
    this.state = { matrix: identityMatrix(), style: defaultStyle() };
    this.opIndex = 0;
  }

  private commitPath(paint: DrawOp["paint"]): void {
    if (this.path.isEmpty()) return;
    this.drawOps.push({
      opId: `op-${this.opIndex}`,
      paint,
      path: this.path.snapshotPath(),
      style: { ...this.state.style },
    });
    this.opIndex += 1;
  }
}
