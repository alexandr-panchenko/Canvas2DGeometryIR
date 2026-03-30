import { describe, expect, test } from "bun:test";
import { builtInScenes, getBuiltInScene } from "../src/playground/fixtures";
import { createBugCaseExport, serializeBugCaseExport } from "../src/playground/export";
import { buildSceneCommands, resolveArcThroughPoint, sceneToDocument } from "../src/playground/scene";
import { bugCaseExportSchema, cloneScene } from "../src/playground/types";

describe("playground export and scene helpers", () => {
  test("scene serialization remains deterministic for built-ins", () => {
    const snapshots = builtInScenes.map((scene) => JSON.stringify(scene));
    const snapshotsAgain = builtInScenes.map((scene) => JSON.stringify(scene));
    expect(snapshotsAgain).toEqual(snapshots);
  });

  test("built-in scene loader returns isolated clones", () => {
    const scene = getBuiltInScene("line-basic");
    expect(scene).not.toBeNull();
    const second = getBuiltInScene("line-basic");
    expect(second).not.toBeNull();
    scene!.paths[0]!.start = { x: 999, y: 999 };
    expect(second!.paths[0]!.start).toEqual({ x: 80, y: 120 });
  });

  test("export keeps scene data and concise click trace serializable", () => {
    const scene = getBuiltInScene("bezier-basic");
    expect(scene).not.toBeNull();

    const payload = createBugCaseExport(
      scene!,
      {
        selectedPathId: scene!.paths[0]!.id,
        selectedPathIds: [scene!.paths[0]!.id],
        selectedHandleId: null,
        selectedCommandId: null,
        showBounds: true,
        showAnchors: true,
      },
      [{ type: "click", at: 2, x: 100, y: 100, target: "path" }],
    );

    const text = serializeBugCaseExport(payload);
    const reparsed = JSON.parse(text);
    const validated = bugCaseExportSchema.parse(reparsed);
    expect(validated.scene.id).toEqual("bezier-basic");
    expect(validated.interactionLog).toEqual([{ type: "click", at: 2, x: 100, y: 100, target: "path" }]);
  });

  test("scene-to-document conversion is deterministic", () => {
    const scene = getBuiltInScene("overlap-mixed");
    expect(scene).not.toBeNull();
    const docA = sceneToDocument(scene!);
    const docB = sceneToDocument(scene!);
    expect(docA).toEqual(docB);
    expect(docA.drawOps.length).toBeGreaterThan(0);
  });

  test("arc control point changes derived arc geometry", () => {
    const scene = getBuiltInScene("overlap-mixed");
    expect(scene).not.toBeNull();
    const working = cloneScene(scene!);
    const path = working.paths.find((entry) => entry.id === "arc-stroke");
    expect(path).not.toBeUndefined();
    const arc = path!.segments[0];
    expect(arc?.kind).toBe("arc");
    if (!arc || arc.kind !== "arc") {
      throw new Error("Expected arc segment");
    }

    const original = resolveArcThroughPoint(path!.start, arc.control, arc.to);
    expect(original).not.toBeNull();
    arc.control = { x: arc.control.x - 60, y: arc.control.y - 40 };
    const moved = resolveArcThroughPoint(path!.start, arc.control, arc.to);
    expect(moved).not.toBeNull();
    expect(moved!.radius).not.toEqual(original!.radius);
    expect(moved!.center).not.toEqual(original!.center);
  });

  test("grouped shapes emit command-based fill and stroke sequence", () => {
    const scene = getBuiltInScene("line-basic");
    expect(scene).not.toBeNull();
    const working = cloneScene(scene!);
    const duplicate = cloneScene(scene!).paths[0]!;
    duplicate.id = "line-b";
    duplicate.name = "Line B";
    duplicate.start = { x: 120, y: 200 };
    duplicate.segments = [{ kind: "line", to: { x: 300, y: 280 } }];
    working.paths.push(duplicate);
    working.shapes.push({
      id: "shape-1",
      name: "Shape 1",
      pathIds: [working.paths[0]!.id, duplicate.id],
      style: { fillStyle: "#10b981", strokeStyle: "#047857", lineWidth: 2 },
      paint: "fill-stroke",
    });
    working.paths[0]!.shapeId = "shape-1";
    duplicate.shapeId = "shape-1";

    const commands = buildSceneCommands(working);
    expect(commands.some((command) => command.kind === "fill" && command.targetId === "shape-1")).toBe(true);
    expect(commands.some((command) => command.kind === "stroke" && command.targetId === "shape-1")).toBe(true);
  });
});
