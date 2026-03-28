import { serializeDocument } from "../serialization";
import type { BugCaseExport, InteractionEvent, PlaygroundScene, ToolStateSnapshot } from "./types";
import { bugCaseExportSchema, cloneScene, sceneToDocument } from "./types";

export const createBugCaseExport = (
  scene: PlaygroundScene,
  toolState: ToolStateSnapshot,
  interactionLog: readonly InteractionEvent[],
): BugCaseExport => {
  const payload: BugCaseExport = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    scene: cloneScene(scene),
    geometryDocument: sceneToDocument(scene),
    toolState,
    interactionLog: interactionLog.map((event) => ({ ...event })),
  };
  return bugCaseExportSchema.parse(payload);
};

export const serializeBugCaseExport = (payload: BugCaseExport): string => JSON.stringify(payload, null, 2);

export const serializeBugCaseExportWithDocumentString = (payload: BugCaseExport): string => {
  const withDocument = {
    ...payload,
    geometryDocument: JSON.parse(serializeDocument(payload.geometryDocument)),
  };
  return JSON.stringify(withDocument, null, 2);
};
