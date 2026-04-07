import { describe, expect, test } from "bun:test";
import { Canvas2DGeometryIRContext, GeometryEngine, deserializeDocument, documentToSvg, replayDocument, serializeDocument } from "../src";
import { sceneToDocument, syncSceneCommands } from "../src/playground/scene";
import type { CanvasLikeReplayTarget } from "../src";
import type { PlaygroundScene } from "../src/playground/types";

class FakeReplayTarget implements CanvasLikeReplayTarget {
  readonly log: string[] = [];
  beginPath(): void { this.log.push("beginPath"); }
  moveTo(x: number, y: number): void { this.log.push(`moveTo:${x},${y}`); }
  lineTo(x: number, y: number): void { this.log.push(`lineTo:${x},${y}`); }
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    this.log.push(`bezier:${cp1x},${cp1y},${cp2x},${cp2y},${x},${y}`);
  }
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void {
    this.log.push(`arc:${x},${y},${radius},${startAngle},${endAngle},${String(counterclockwise)}`);
  }
  closePath(): void { this.log.push("closePath"); }
  fill(fillRule?: "nonzero" | "evenodd"): void { this.log.push(`fill:${fillRule ?? "nonzero"}`); }
  stroke(): void { this.log.push("stroke"); }
  setFillStyle(value: string): void { this.log.push(`fillStyle:${value}`); }
  setStrokeStyle(value: string): void { this.log.push(`strokeStyle:${value}`); }
  setLineWidth(value: number): void { this.log.push(`lineWidth:${value}`); }
  setLineDash(value: readonly number[]): void { this.log.push(`lineDash:${value.join(",")}`); }
  setLineCap(value: "butt" | "round" | "square"): void { this.log.push(`lineCap:${value}`); }
  setLineJoin(value: "miter" | "round" | "bevel"): void { this.log.push(`lineJoin:${value}`); }
  setMiterLimit(value: number): void { this.log.push(`miterLimit:${value}`); }
  setGlobalAlpha(value: number): void { this.log.push(`alpha:${value}`); }
}

describe("Canvas2DGeometryIR", () => {
  test("records deterministically", () => {
    const build = (): string => {
      const ctx = new Canvas2DGeometryIRContext();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(100, 0);
      ctx.lineTo(100, 100);
      ctx.closePath();
      ctx.fillStyle = "#f00";
      ctx.fill();
      return serializeDocument(ctx.getDocument());
    };
    expect(build()).toEqual(build());
  });

  test("supports paint bounds, hit test, closest point, anchors, inspection, and rect queries", () => {
    const ctx = new Canvas2DGeometryIRContext();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(50, 0);
    ctx.lineTo(50, 50);
    ctx.lineTo(0, 50);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, 25);
    ctx.lineTo(75, 25);
    ctx.lineWidth = 4;
    ctx.lineDash = [6, 2];
    ctx.lineCap = "round";
    ctx.stroke();

    const doc = ctx.getDocument();
    const engine = new GeometryEngine(doc);

    const geometryBounds = engine.getGeometryBounds();
    expect(geometryBounds).not.toBeNull();
    expect(geometryBounds?.maxX).toBe(75);

    const bounds = engine.getPaintBounds();
    expect(bounds).not.toBeNull();
    expect(bounds?.maxX).toBeGreaterThan(geometryBounds!.maxX);
    expect(bounds?.minY).toBe(geometryBounds!.minY);

    const hitFill = engine.hitTestPoint({ x: 10, y: 10 });
    expect(hitFill.some((h) => h.paint === "fill")).toBeTrue();

    const hitStroke = engine.hitTestPoint({ x: 10, y: 25 });
    expect(hitStroke.some((h) => h.paint === "stroke")).toBeTrue();

    const closest = engine.closestPoint({ x: 76, y: 26 });
    expect(closest).not.toBeNull();
    expect(closest!.distance).toBeLessThan(3);
    expect(Math.hypot(closest!.tangent.x, closest!.tangent.y)).toBeCloseTo(1, 5);
    expect(Math.hypot(closest!.normal.x, closest!.normal.y)).toBeCloseTo(1, 5);

    const anchors = engine.getAnchorCandidates();
    expect(anchors.length).toBeGreaterThan(0);

    const inspect = engine.inspectPath("op-0");
    expect(inspect?.segmentKinds).toContain("line");

    const intersections = engine.getPathIntersections("op-0", "op-1");
    expect(intersections.length).toBeGreaterThan(0);

    const rectHits = engine.queryRect({ minX: 5, minY: 5, maxX: 10, maxY: 10 });
    expect(rectHits.some((result) => result.paint === "fill" && result.containsRect)).toBeTrue();
    expect(rectHits.some((result) => result.paint === "fill" && result.intersects)).toBeTrue();
  });

  test("replay consistency and serialization roundtrip", () => {
    const ctx = new Canvas2DGeometryIRContext();
    ctx.beginPath();
    ctx.moveTo(10, 10);
    ctx.bezierCurveTo(30, 20, 50, 40, 70, 10);
    ctx.strokeStyle = "#00f";
    ctx.lineWidth = 2;
    ctx.lineDash = [3, 1];
    ctx.lineJoin = "round";
    ctx.strokeOpacity = 0.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(40, 40, 20, 0, Math.PI, false);
    ctx.fillOpacity = 0.25;
    ctx.fill("evenodd");

    const document = ctx.getDocument();
    const json = serializeDocument(document);
    const roundtrip = deserializeDocument(json);
    expect(roundtrip).toEqual(document);

    const replayTarget = new FakeReplayTarget();
    replayDocument(roundtrip, replayTarget);
    expect(replayTarget.log).toContain("stroke");
    expect(replayTarget.log).toContain("fill:evenodd");
    expect(replayTarget.log).toContain("lineDash:3,1");
    expect(replayTarget.log).toContain("lineJoin:round");
    expect(replayTarget.log).toContain("alpha:0.5");
    expect(replayTarget.log).toContain("alpha:0.25");
    expect(replayTarget.log.some((entry) => entry.startsWith("bezier:"))).toBeTrue();
    expect(replayTarget.log.some((entry) => entry.startsWith("arc:"))).toBeTrue();
  });

  test("supports evenodd fill rule for holes", () => {
    const ctx = new Canvas2DGeometryIRContext();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(100, 0);
    ctx.lineTo(100, 100);
    ctx.lineTo(0, 100);
    ctx.closePath();
    ctx.moveTo(25, 25);
    ctx.lineTo(75, 25);
    ctx.lineTo(75, 75);
    ctx.lineTo(25, 75);
    ctx.closePath();
    ctx.fill("evenodd");

    const engine = new GeometryEngine(ctx.getDocument());
    expect(engine.hitTestPoint({ x: 10, y: 10 }).length).toBe(1);
    expect(engine.hitTestPoint({ x: 50, y: 50 }).length).toBe(0);
    const rectHits = engine.queryRect({ minX: 30, minY: 30, maxX: 70, maxY: 70 });
    expect(rectHits.some((result) => result.containsRect)).toBeFalse();
  });

  test("supports svg export", () => {
    const ctx = new Canvas2DGeometryIRContext();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(40, 0);
    ctx.lineTo(40, 40);
    ctx.lineTo(0, 40);
    ctx.closePath();
    ctx.fillStyle = "#22c55e";
    ctx.fillOpacity = 0.4;
    ctx.fill("evenodd");

    const document = ctx.getDocument();
    const svg = documentToSvg(document, { padding: 2, background: "#ffffff" });
    expect(svg).toContain("fill-opacity=\"0.4\"");
    expect(svg).toContain("<svg");
  });

  test("lowers arcs to bezier geometry under non-uniform transforms", () => {
    const ctx = new Canvas2DGeometryIRContext();
    ctx.scale(2, 1);
    ctx.beginPath();
    ctx.arc(20, 20, 10, 0, Math.PI, false);
    ctx.stroke();

    const document = ctx.getDocument();
    const inspect = new GeometryEngine(document).inspectPath("op-0");
    expect(inspect?.segmentKinds.every((kind) => kind === "bezier")).toBeTrue();
  });

  test("curve through points lowers to standard bezier geometry", () => {
    const scene: PlaygroundScene = {
      id: "curve-demo",
      name: "Curve demo",
      paths: [
        {
          id: "curve-path",
          name: "Curve path",
          style: { fillStyle: "#000000", strokeStyle: "#000", lineWidth: 2 },
          paint: "stroke",
          start: { x: 40, y: 140 },
          segments: [
            {
              kind: "curveThroughPoints",
              points: [
                { x: 110, y: 50 },
                { x: 190, y: 190 },
                { x: 280, y: 90 },
              ],
              to: { x: 280, y: 90 },
            },
          ],
          closed: false,
          shapeId: null,
        },
      ],
      shapes: [],
      commands: [],
    };

    syncSceneCommands(scene);
    expect(scene.commands.some((command) => command.kind === "curveThroughPoints")).toBeTrue();

    const document = sceneToDocument(scene);
    const engine = new GeometryEngine(document);
    const inspect = engine.inspectPath("op-0");
    expect(inspect?.segmentKinds.includes("bezier")).toBeTrue();
  });
});
