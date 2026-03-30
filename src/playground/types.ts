import { z } from "zod";
import { geometryDocumentZodSchema } from "../serialization";
import type { GeometryDocument, Point } from "../types";

export type ScenePaintMode = "fill" | "stroke" | "fill-stroke";

export interface SceneStyle {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
}

export type SceneSegment =
  | { readonly kind: "line"; to: Point }
  | { readonly kind: "bezier"; cp1: Point; cp2: Point; to: Point }
  | { readonly kind: "arc"; control: Point; to: Point };

export interface ScenePath {
  id: string;
  name: string;
  style: SceneStyle;
  paint: ScenePaintMode;
  start: Point;
  segments: SceneSegment[];
  closed: boolean;
  shapeId: string | null;
}

export interface SceneShape {
  id: string;
  name: string;
  pathIds: string[];
  style: SceneStyle;
  paint: ScenePaintMode;
}

export type SceneCommand =
  | { readonly id: string; readonly kind: "beginPath"; readonly targetId: string; readonly targetType: "path" | "shape" }
  | { readonly id: string; readonly kind: "moveTo"; readonly x: number; readonly y: number; readonly pathId: string }
  | { readonly id: string; readonly kind: "lineTo"; readonly x: number; readonly y: number; readonly pathId: string; readonly segmentIndex: number }
  | {
      readonly id: string;
      readonly kind: "bezierCurveTo";
      readonly cp1: Point;
      readonly cp2: Point;
      readonly to: Point;
      readonly pathId: string;
      readonly segmentIndex: number;
    }
  | {
      readonly id: string;
      readonly kind: "arc";
      readonly center: Point | null;
      readonly radius: number | null;
      readonly startAngle: number | null;
      readonly endAngle: number | null;
      readonly counterclockwise: boolean | null;
      readonly valid: boolean;
      readonly pathId: string;
      readonly segmentIndex: number;
    }
  | { readonly id: string; readonly kind: "closePath"; readonly pathId: string }
  | { readonly id: string; readonly kind: "fill"; readonly targetId: string; readonly style: SceneStyle }
  | { readonly id: string; readonly kind: "stroke"; readonly targetId: string; readonly style: SceneStyle };

export interface PlaygroundScene {
  id: string;
  name: string;
  paths: ScenePath[];
  shapes: SceneShape[];
  commands: SceneCommand[];
}

export interface ToolStateSnapshot {
  readonly selectedPathId: string | null;
  readonly selectedPathIds: readonly string[];
  readonly selectedHandleId: string | null;
  readonly selectedCommandId: string | null;
  readonly showBounds: boolean;
  readonly showAnchors: boolean;
}

export interface InteractionEvent {
  readonly type: "click";
  readonly at: number;
  readonly x: number;
  readonly y: number;
  readonly target: "path" | "control-point" | "empty";
}

export interface BugCaseExport {
  readonly schemaVersion: 1;
  readonly exportedAt: string;
  readonly scene: PlaygroundScene;
  readonly geometryDocument: GeometryDocument;
  readonly toolState: ToolStateSnapshot;
  readonly interactionLog: readonly InteractionEvent[];
}

const pointSchema = z.object({ x: z.number(), y: z.number() });
const sceneStyleSchema = z.object({
  fillStyle: z.string(),
  strokeStyle: z.string(),
  lineWidth: z.number(),
});

const lineSchema = z.object({ kind: z.literal("line"), to: pointSchema });
const bezierSchema = z.object({ kind: z.literal("bezier"), cp1: pointSchema, cp2: pointSchema, to: pointSchema });
const arcSchema = z.object({ kind: z.literal("arc"), control: pointSchema, to: pointSchema });

const scenePathSchema = z.object({
  id: z.string(),
  name: z.string(),
  style: sceneStyleSchema,
  paint: z.enum(["fill", "stroke", "fill-stroke"]),
  start: pointSchema,
  segments: z.array(z.discriminatedUnion("kind", [lineSchema, bezierSchema, arcSchema])),
  closed: z.boolean(),
  shapeId: z.string().nullable(),
});

const sceneShapeSchema = z.object({
  id: z.string(),
  name: z.string(),
  pathIds: z.array(z.string()),
  style: sceneStyleSchema,
  paint: z.enum(["fill", "stroke", "fill-stroke"]),
});

const sceneCommandSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string(), kind: z.literal("beginPath"), targetId: z.string(), targetType: z.enum(["path", "shape"]) }),
  z.object({ id: z.string(), kind: z.literal("moveTo"), x: z.number(), y: z.number(), pathId: z.string() }),
  z.object({ id: z.string(), kind: z.literal("lineTo"), x: z.number(), y: z.number(), pathId: z.string(), segmentIndex: z.number() }),
  z.object({
    id: z.string(),
    kind: z.literal("bezierCurveTo"),
    cp1: pointSchema,
    cp2: pointSchema,
    to: pointSchema,
    pathId: z.string(),
    segmentIndex: z.number(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("arc"),
    center: pointSchema.nullable(),
    radius: z.number().nullable(),
    startAngle: z.number().nullable(),
    endAngle: z.number().nullable(),
    counterclockwise: z.boolean().nullable(),
    valid: z.boolean(),
    pathId: z.string(),
    segmentIndex: z.number(),
  }),
  z.object({ id: z.string(), kind: z.literal("closePath"), pathId: z.string() }),
  z.object({ id: z.string(), kind: z.literal("fill"), targetId: z.string(), style: sceneStyleSchema }),
  z.object({ id: z.string(), kind: z.literal("stroke"), targetId: z.string(), style: sceneStyleSchema }),
]);

const sceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  paths: z.array(scenePathSchema),
  shapes: z.array(sceneShapeSchema),
  commands: z.array(sceneCommandSchema),
});

export const interactionEventSchema = z.object({
  type: z.literal("click"),
  at: z.number(),
  x: z.number(),
  y: z.number(),
  target: z.enum(["path", "control-point", "empty"]),
});

export const toolStateSnapshotSchema = z.object({
  selectedPathId: z.string().nullable(),
  selectedPathIds: z.array(z.string()),
  selectedHandleId: z.string().nullable(),
  selectedCommandId: z.string().nullable(),
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

export const cloneScene = (scene: PlaygroundScene): PlaygroundScene => ({
  ...scene,
  paths: scene.paths.map((path) => ({
    ...path,
    style: { ...path.style },
    start: { ...path.start },
    segments: path.segments.map((segment) => {
      if (segment.kind === "line") {
        return { ...segment, to: { ...segment.to } };
      }
      if (segment.kind === "bezier") {
        return { ...segment, cp1: { ...segment.cp1 }, cp2: { ...segment.cp2 }, to: { ...segment.to } };
      }
      return { ...segment, control: { ...segment.control }, to: { ...segment.to } };
    }),
  })),
  shapes: scene.shapes.map((shape) => ({
    ...shape,
    pathIds: [...shape.pathIds],
    style: { ...shape.style },
  })),
  commands: scene.commands.map((command) => {
    if (command.kind === "bezierCurveTo") {
      return { ...command, cp1: { ...command.cp1 }, cp2: { ...command.cp2 }, to: { ...command.to } };
    }
    if (command.kind === "arc") {
      return {
        ...command,
        center: command.center ? { ...command.center } : null,
      };
    }
    if ("style" in command) {
      return { ...command, style: { ...command.style } };
    }
    return { ...command };
  }),
});
