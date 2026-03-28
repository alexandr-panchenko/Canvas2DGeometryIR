import { z } from "zod";
import { geometryDocumentZodSchema } from "../serialization";
import type { DrawOp, GeometryDocument, Point } from "../types";

export type SceneSegment =
  | { readonly kind: "line"; to: Point }
  | { readonly kind: "bezier"; cp1: Point; cp2: Point; to: Point }
  | {
      readonly kind: "arc";
      center: Point;
      to: Point;
      radius: number;
      startAngle: number;
      endAngle: number;
      counterclockwise: boolean;
    };

export interface ScenePath {
  id: string;
  paint: "fill" | "stroke";
  style: { fillStyle: string; strokeStyle: string; lineWidth: number };
  start: Point;
  segments: SceneSegment[];
  closed: boolean;
}

export interface PlaygroundScene {
  id: string;
  name: string;
  paths: ScenePath[];
}

export type ToolMode = "select" | "edit-points";

export interface ToolStateSnapshot {
  readonly mode: ToolMode;
  readonly selectedPathId: string | null;
  readonly selectedHandleId: string | null;
  readonly showBounds: boolean;
  readonly showAnchors: boolean;
}

export type InteractionEvent =
  | { readonly type: "pointer-down"; readonly at: number; readonly x: number; readonly y: number; readonly target: string | null }
  | { readonly type: "pointer-move"; readonly at: number; readonly x: number; readonly y: number }
  | { readonly type: "pointer-up"; readonly at: number; readonly x: number; readonly y: number }
  | { readonly type: "tool-mode-changed"; readonly at: number; readonly mode: ToolMode }
  | { readonly type: "selection-changed"; readonly at: number; readonly selectedPathId: string | null }
  | { readonly type: "drag-start"; readonly at: number; readonly kind: "path" | "handle"; readonly targetId: string }
  | { readonly type: "drag-move"; readonly at: number; readonly kind: "path" | "handle"; readonly targetId: string; readonly dx: number; readonly dy: number }
  | { readonly type: "drag-end"; readonly at: number; readonly kind: "path" | "handle"; readonly targetId: string }
  | { readonly type: "scene-mutated"; readonly at: number; readonly mutation: string; readonly pathId: string };

export interface BugCaseExport {
  readonly schemaVersion: 1;
  readonly exportedAt: string;
  readonly scene: PlaygroundScene;
  readonly geometryDocument: GeometryDocument;
  readonly toolState: ToolStateSnapshot;
  readonly interactionLog: readonly InteractionEvent[];
}

const pointSchema = z.object({ x: z.number(), y: z.number() });
const lineSchema = z.object({ kind: z.literal("line"), to: pointSchema });
const bezierSchema = z.object({ kind: z.literal("bezier"), cp1: pointSchema, cp2: pointSchema, to: pointSchema });
const arcSchema = z.object({
  kind: z.literal("arc"),
  center: pointSchema,
  to: pointSchema,
  radius: z.number(),
  startAngle: z.number(),
  endAngle: z.number(),
  counterclockwise: z.boolean(),
});

const scenePathSchema = z.object({
  id: z.string(),
  paint: z.enum(["fill", "stroke"]),
  style: z.object({ fillStyle: z.string(), strokeStyle: z.string(), lineWidth: z.number() }),
  start: pointSchema,
  segments: z.array(z.discriminatedUnion("kind", [lineSchema, bezierSchema, arcSchema])),
  closed: z.boolean(),
});

const sceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  paths: z.array(scenePathSchema),
});

const interactionEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pointer-down"), at: z.number(), x: z.number(), y: z.number(), target: z.string().nullable() }),
  z.object({ type: z.literal("pointer-move"), at: z.number(), x: z.number(), y: z.number() }),
  z.object({ type: z.literal("pointer-up"), at: z.number(), x: z.number(), y: z.number() }),
  z.object({ type: z.literal("tool-mode-changed"), at: z.number(), mode: z.enum(["select", "edit-points"]) }),
  z.object({ type: z.literal("selection-changed"), at: z.number(), selectedPathId: z.string().nullable() }),
  z.object({ type: z.literal("drag-start"), at: z.number(), kind: z.enum(["path", "handle"]), targetId: z.string() }),
  z.object({ type: z.literal("drag-move"), at: z.number(), kind: z.enum(["path", "handle"]), targetId: z.string(), dx: z.number(), dy: z.number() }),
  z.object({ type: z.literal("drag-end"), at: z.number(), kind: z.enum(["path", "handle"]), targetId: z.string() }),
  z.object({ type: z.literal("scene-mutated"), at: z.number(), mutation: z.string(), pathId: z.string() }),
]);

export const toolStateSnapshotSchema = z.object({
  mode: z.enum(["select", "edit-points"]),
  selectedPathId: z.string().nullable(),
  selectedHandleId: z.string().nullable(),
  showBounds: z.boolean(),
  showAnchors: z.boolean(),
});

export const bugCaseExportSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string(),
  scene: sceneSchema,
  geometryDocument: geometryDocumentZodSchema,
  toolState: toolStateSnapshotSchema,
  interactionLog: z.array(interactionEventSchema),
});

export const toDrawOps = (scene: PlaygroundScene): DrawOp[] =>
  scene.paths.map((path, index) => {
    let cursor: Point = { ...path.start };
    const segments: DrawOp["path"]["subpaths"][number]["segments"] = path.segments.map((segment) => {
      if (segment.kind === "line") {
        const resolved = { kind: "line" as const, from: { ...cursor }, to: { ...segment.to } };
        cursor = { ...segment.to };
        return resolved;
      }
      if (segment.kind === "bezier") {
        const resolved = {
          kind: "bezier" as const,
          from: { ...cursor },
          cp1: { ...segment.cp1 },
          cp2: { ...segment.cp2 },
          to: { ...segment.to },
        };
        cursor = { ...segment.to };
        return resolved;
      }
      const resolved = {
        kind: "arc" as const,
        center: { ...segment.center },
        radius: segment.radius,
        startAngle: segment.startAngle,
        endAngle: segment.endAngle,
        counterclockwise: segment.counterclockwise,
      };
      cursor = { ...segment.to };
      return resolved;
    });

    return {
      opId: `op-${index}`,
      paint: path.paint,
      style: { ...path.style },
      path: {
        subpaths: [
          {
            start: { ...path.start },
            segments,
            closed: path.closed,
          },
        ],
      },
    };
  });

export const sceneToDocument = (scene: PlaygroundScene): GeometryDocument => ({ version: 1, drawOps: toDrawOps(scene) });

export const cloneScene = (scene: PlaygroundScene): PlaygroundScene => ({
  ...scene,
  paths: scene.paths.map((path) => ({
    ...path,
    style: { ...path.style },
    start: { ...path.start },
    segments: path.segments.map((segment) => {
      if (segment.kind === "line") return { ...segment, to: { ...segment.to } };
      if (segment.kind === "bezier") {
        return { ...segment, cp1: { ...segment.cp1 }, cp2: { ...segment.cp2 }, to: { ...segment.to } };
      }
      return { ...segment, center: { ...segment.center }, to: { ...segment.to } };
    }),
  })),
});
