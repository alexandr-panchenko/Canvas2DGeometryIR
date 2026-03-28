import { z } from "zod";
import type { GeometryDocument } from "./types";

const pointSchema = z.object({ x: z.number(), y: z.number() });

const lineSegmentSchema = z.object({
  kind: z.literal("line"),
  from: pointSchema,
  to: pointSchema,
});

const bezierSegmentSchema = z.object({
  kind: z.literal("bezier"),
  from: pointSchema,
  cp1: pointSchema,
  cp2: pointSchema,
  to: pointSchema,
});

const arcSegmentSchema = z.object({
  kind: z.literal("arc"),
  center: pointSchema,
  radius: z.number().nonnegative(),
  startAngle: z.number(),
  endAngle: z.number(),
  counterclockwise: z.boolean(),
});

const segmentSchema = z.discriminatedUnion("kind", [lineSegmentSchema, bezierSegmentSchema, arcSegmentSchema]);

const subpathSchema = z.object({
  start: pointSchema,
  segments: z.array(segmentSchema),
  closed: z.boolean(),
});

const paintStyleSchema = z.object({
  fillStyle: z.string(),
  strokeStyle: z.string(),
  lineWidth: z.number().positive(),
});

const drawOpSchema = z.object({
  opId: z.string(),
  paint: z.enum(["fill", "stroke"]),
  path: z.object({ subpaths: z.array(subpathSchema) }),
  style: paintStyleSchema,
});

const geometryDocumentSchema = z.object({
  version: z.literal(1),
  drawOps: z.array(drawOpSchema),
});

export const serializeDocument = (document: GeometryDocument): string => JSON.stringify(document);

export const deserializeDocument = (json: string): GeometryDocument => geometryDocumentSchema.parse(JSON.parse(json));

export const geometryDocumentZodSchema = geometryDocumentSchema;
