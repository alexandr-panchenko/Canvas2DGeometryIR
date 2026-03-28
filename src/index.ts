export { Canvas2DGeometryIRContext } from "./context";
export { GeometryEngine } from "./geometry";
export { replayDocument, replayDrawOp } from "./replay";
export { serializeDocument, deserializeDocument, geometryDocumentZodSchema } from "./serialization";

export type {
  AnchorCandidate,
  ClosestPointResult,
  DrawOp,
  GeometryDocument,
  Matrix2D,
  PaintStyle,
  PathGeometry,
  Point,
  Rect,
  Segment,
} from "./types";
export type { CanvasLikeReplayTarget } from "./replay";
