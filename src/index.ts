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

export { builtInScenes, getBuiltInScene } from "./playground/fixtures";
export { createBugCaseExport, serializeBugCaseExport, serializeBugCaseExportWithDocumentString } from "./playground/export";
export { buildSceneCommands, resolveArcThroughPoint, sceneToDocument, syncSceneCommands } from "./playground/scene";
export type {
  BugCaseExport,
  InteractionEvent,
  PlaygroundScene,
  SceneCommand,
  ScenePaintMode,
  ScenePath,
  SceneSegment,
  SceneShape,
  SceneStyle,
  ToolStateSnapshot,
} from "./playground/types";
