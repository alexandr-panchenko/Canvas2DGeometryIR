import { describe, expect, test } from "bun:test";
import { builtInScenes, getBuiltInScene } from "../src/playground/fixtures";
import { createBugCaseExport, serializeBugCaseExport } from "../src/playground/export";
import { bugCaseExportSchema, sceneToDocument } from "../src/playground/types";

describe("playground bug case infrastructure", () => {
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

  test("event log and bug export are serializable", () => {
    const scene = getBuiltInScene("bezier-basic");
    expect(scene).not.toBeNull();

    const payload = createBugCaseExport(
      scene!,
      {
        mode: "select",
        selectedPathId: scene!.paths[0]!.id,
        selectedHandleId: null,
        showBounds: true,
        showAnchors: false,
      },
      [
        { type: "tool-mode-changed", at: 1, mode: "select" },
        { type: "pointer-down", at: 2, x: 100, y: 100, target: scene!.paths[0]!.id },
        { type: "drag-start", at: 3, kind: "path", targetId: scene!.paths[0]!.id },
      ],
    );

    const text = serializeBugCaseExport(payload);
    const reparsed = JSON.parse(text);
    const validated = bugCaseExportSchema.parse(reparsed);
    expect(validated.scene.id).toEqual("bezier-basic");
    expect(validated.interactionLog.length).toBe(3);
  });

  test("scene-to-document conversion is deterministic", () => {
    const scene = getBuiltInScene("overlap-mixed");
    expect(scene).not.toBeNull();
    const docA = sceneToDocument(scene!);
    const docB = sceneToDocument(scene!);
    expect(docA).toEqual(docB);
    expect(docA.drawOps.length).toBeGreaterThan(0);
  });
});
