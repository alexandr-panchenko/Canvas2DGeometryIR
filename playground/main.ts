import { GeometryEngine } from "../src/geometry";
import type { Point, Rect } from "../src/types";
import { builtInScenes, getBuiltInScene } from "../src/playground/fixtures";
import { createBugCaseExport, serializeBugCaseExportWithDocumentString } from "../src/playground/export";
import { cloneScene, sceneToDocument } from "../src/playground/types";
import type {
  InteractionEvent,
  PlaygroundScene,
  ScenePath,
  SceneSegment,
  ToolMode,
  ToolStateSnapshot,
} from "../src/playground/types";

interface HandleRef {
  readonly id: string;
  readonly pathId: string;
  readonly segmentIndex: number;
  readonly role: "start" | "to" | "cp1" | "cp2" | "center";
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app");
}

app.innerHTML = `
  <div class="toolbar">
    <label>Scene
      <select id="scene-select"></select>
    </label>
    <button id="new-path">New Path</button>
    <button id="add-line">Add Line</button>
    <button id="add-bezier">Add Bézier</button>
    <button id="add-arc">Add Arc</button>
    <label>Mode
      <select id="mode-select">
        <option value="select">Select / Drag</option>
        <option value="edit-points">Edit Points</option>
      </select>
    </label>
    <label><input id="toggle-bounds" type="checkbox" checked /> Bounds</label>
    <label><input id="toggle-anchors" type="checkbox" /> Anchors</label>
    <button id="export">Export Bug Case</button>
  </div>
  <div class="main">
    <canvas id="canvas" width="960" height="600"></canvas>
    <div class="panel">
      <h3>Selection</h3>
      <pre id="selection-view"></pre>
      <h3>Export</h3>
      <textarea id="export-view" rows="18" spellcheck="false"></textarea>
      <h3>Interaction log (recent)</h3>
      <pre id="log-view"></pre>
    </div>
  </div>
`;

const canvas = app.querySelector<HTMLCanvasElement>("#canvas");
const selectionView = app.querySelector<HTMLPreElement>("#selection-view");
const exportView = app.querySelector<HTMLTextAreaElement>("#export-view");
const logView = app.querySelector<HTMLPreElement>("#log-view");
const sceneSelect = app.querySelector<HTMLSelectElement>("#scene-select");
const modeSelect = app.querySelector<HTMLSelectElement>("#mode-select");
const toggleBounds = app.querySelector<HTMLInputElement>("#toggle-bounds");
const toggleAnchors = app.querySelector<HTMLInputElement>("#toggle-anchors");
const newPathButton = app.querySelector<HTMLButtonElement>("#new-path");
const addLineButton = app.querySelector<HTMLButtonElement>("#add-line");
const addBezierButton = app.querySelector<HTMLButtonElement>("#add-bezier");
const addArcButton = app.querySelector<HTMLButtonElement>("#add-arc");
const exportButton = app.querySelector<HTMLButtonElement>("#export");

if (
  !canvas ||
  !selectionView ||
  !exportView ||
  !logView ||
  !sceneSelect ||
  !modeSelect ||
  !toggleBounds ||
  !toggleAnchors ||
  !newPathButton ||
  !addLineButton ||
  !addBezierButton ||
  !addArcButton ||
  !exportButton
) {
  throw new Error("UI wiring failed");
}

const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Missing 2d context");

for (const scene of builtInScenes) {
  const option = document.createElement("option");
  option.value = scene.id;
  option.textContent = scene.name;
  sceneSelect.append(option);
}

let scene: PlaygroundScene = cloneScene(builtInScenes[0]!);
let selectedPathId: string | null = scene.paths[0]?.id ?? null;
let selectedHandleId: string | null = null;
let toolMode: ToolMode = "select";
const interactionLog: InteractionEvent[] = [];
let pointerDown: { x: number; y: number } | null = null;
let drag:
  | { kind: "path"; pathId: string }
  | { kind: "handle"; handle: HandleRef }
  | null = null;

const pushLog = (event: InteractionEvent): void => {
  interactionLog.push(event);
  if (interactionLog.length > 300) interactionLog.shift();
};

const getToolState = (): ToolStateSnapshot => ({
  mode: toolMode,
  selectedPathId,
  selectedHandleId,
  showBounds: toggleBounds.checked,
  showAnchors: toggleAnchors.checked,
});

const pointerToCanvas = (event: PointerEvent): Point => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
};

const getPathById = (pathId: string | null): ScenePath | null => {
  if (!pathId) return null;
  return scene.paths.find((path) => path.id === pathId) ?? null;
};

const collectHandles = (path: ScenePath): HandleRef[] => {
  const handles: HandleRef[] = [{ id: `${path.id}:start`, pathId: path.id, segmentIndex: -1, role: "start" }];
  path.segments.forEach((segment, index) => {
    handles.push({ id: `${path.id}:${index}:to`, pathId: path.id, segmentIndex: index, role: "to" });
    if (segment.kind === "bezier") {
      handles.push({ id: `${path.id}:${index}:cp1`, pathId: path.id, segmentIndex: index, role: "cp1" });
      handles.push({ id: `${path.id}:${index}:cp2`, pathId: path.id, segmentIndex: index, role: "cp2" });
    }
    if (segment.kind === "arc") {
      handles.push({ id: `${path.id}:${index}:center`, pathId: path.id, segmentIndex: index, role: "center" });
    }
  });
  return handles;
};

const getHandlePoint = (path: ScenePath, handle: HandleRef): Point => {
  if (handle.role === "start") return path.start;
  const segment = path.segments[handle.segmentIndex];
  if (!segment) return path.start;
  if (handle.role === "to") return segment.to;
  if (segment.kind === "bezier" && handle.role === "cp1") return segment.cp1;
  if (segment.kind === "bezier" && handle.role === "cp2") return segment.cp2;
  if (segment.kind === "arc" && handle.role === "center") return segment.center;
  return segment.to;
};

const setHandlePoint = (path: ScenePath, handle: HandleRef, point: Point): void => {
  if (handle.role === "start") {
    path.start = point;
    return;
  }
  const segment = path.segments[handle.segmentIndex];
  if (!segment) return;
  if (handle.role === "to") {
    segment.to = point;
    return;
  }
  if (segment.kind === "bezier" && handle.role === "cp1") {
    segment.cp1 = point;
    return;
  }
  if (segment.kind === "bezier" && handle.role === "cp2") {
    segment.cp2 = point;
    return;
  }
  if (segment.kind === "arc" && handle.role === "center") {
    segment.center = point;
  }
};

const hitHandle = (point: Point): HandleRef | null => {
  const path = getPathById(selectedPathId);
  if (!path) return null;
  const handles = collectHandles(path);
  const radius = 8;
  for (const handle of handles) {
    const hp = getHandlePoint(path, handle);
    const distance = Math.hypot(hp.x - point.x, hp.y - point.y);
    if (distance <= radius) return handle;
  }
  return null;
};

const translatePath = (path: ScenePath, dx: number, dy: number): void => {
  path.start = { x: path.start.x + dx, y: path.start.y + dy };
  path.segments = path.segments.map((segment) => {
    if (segment.kind === "line") {
      return { ...segment, to: { x: segment.to.x + dx, y: segment.to.y + dy } };
    }
    if (segment.kind === "bezier") {
      return {
        ...segment,
        cp1: { x: segment.cp1.x + dx, y: segment.cp1.y + dy },
        cp2: { x: segment.cp2.x + dx, y: segment.cp2.y + dy },
        to: { x: segment.to.x + dx, y: segment.to.y + dy },
      };
    }
    return {
      ...segment,
      center: { x: segment.center.x + dx, y: segment.center.y + dy },
      to: { x: segment.to.x + dx, y: segment.to.y + dy },
    };
  });
};

const drawOverlayBounds = (bounds: Rect): void => {
  ctx.save();
  ctx.strokeStyle = "#22c55e";
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1;
  ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  ctx.restore();
};

const drawHandle = (point: Point, active: boolean): void => {
  ctx.save();
  ctx.fillStyle = active ? "#f59e0b" : "#111827";
  ctx.beginPath();
  ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const buildCanvasPath = (path: ScenePath): Path2D => {
  const shape = new Path2D();
  shape.moveTo(path.start.x, path.start.y);
  for (const segment of path.segments) {
    if (segment.kind === "line") {
      shape.lineTo(segment.to.x, segment.to.y);
    } else if (segment.kind === "bezier") {
      shape.bezierCurveTo(segment.cp1.x, segment.cp1.y, segment.cp2.x, segment.cp2.y, segment.to.x, segment.to.y);
    } else {
      shape.arc(segment.center.x, segment.center.y, segment.radius, segment.startAngle, segment.endAngle, segment.counterclockwise);
    }
  }
  if (path.closed) shape.closePath();
  return shape;
};

const addSegmentToSelectedPath = (segment: SceneSegment): void => {
  const target = getPathById(selectedPathId);
  if (!target) return;
  target.segments.push(segment);
  pushLog({ type: "scene-mutated", at: Date.now(), mutation: `add-segment:${segment.kind}`, pathId: target.id });
  render();
};

const addNewPath = (): void => {
  const id = `path-${scene.paths.length + 1}`;
  const path: ScenePath = {
    id,
    paint: "stroke",
    style: { fillStyle: "#000000", strokeStyle: "#334155", lineWidth: 3 },
    start: { x: 140, y: 160 },
    segments: [{ kind: "line", to: { x: 280, y: 220 } }],
    closed: false,
  };
  scene.paths.push(path);
  selectedPathId = path.id;
  selectedHandleId = null;
  pushLog({ type: "scene-mutated", at: Date.now(), mutation: "create-path", pathId: path.id });
  pushLog({ type: "selection-changed", at: Date.now(), selectedPathId });
  render();
};

const pickPath = (point: Point): string | null => {
  const doc = sceneToDocument(scene);
  const engine = new GeometryEngine(doc);
  const hits = engine.hitTestPoint(point);
  if (hits.length > 0) {
    const top = hits[hits.length - 1]!;
    const opIndex = Number.parseInt(top.opId.replace("op-", ""), 10);
    return scene.paths[opIndex]?.id ?? null;
  }

  for (let i = scene.paths.length - 1; i >= 0; i -= 1) {
    const candidate = scene.paths[i]!;
    const path2d = buildCanvasPath(candidate);
    const tolerance = Math.max(8, candidate.style.lineWidth * 1.5);
    if (ctx.isPointInStroke(path2d, point.x, point.y) || ctx.isPointInPath(path2d, point.x, point.y)) {
      return candidate.id;
    }
    for (let d = 1; d <= tolerance; d += 3) {
      if (ctx.isPointInStroke(path2d, point.x + d, point.y + d)) return candidate.id;
    }
  }
  return null;
};

const render = (): void => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const doc = sceneToDocument(scene);
  const engine = new GeometryEngine(doc);

  scene.paths.forEach((path) => {
    const shape = buildCanvasPath(path);
    if (path.paint === "fill") {
      ctx.fillStyle = path.style.fillStyle;
      ctx.fill(shape);
      ctx.strokeStyle = path.style.strokeStyle;
      ctx.lineWidth = path.style.lineWidth;
      ctx.stroke(shape);
    } else {
      ctx.strokeStyle = path.style.strokeStyle;
      ctx.lineWidth = path.style.lineWidth;
      ctx.stroke(shape);
    }

    if (path.id === selectedPathId) {
      ctx.save();
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke(shape);
      ctx.restore();
    }
  });

  if (toggleBounds.checked) {
    const bounds = engine.getBounds();
    if (bounds) drawOverlayBounds(bounds);
  }

  if (toggleAnchors.checked) {
    const anchors = engine.getAnchorCandidates();
    ctx.save();
    ctx.fillStyle = "#7c3aed";
    for (const anchor of anchors) {
      ctx.beginPath();
      ctx.arc(anchor.point.x, anchor.point.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const selectedPath = getPathById(selectedPathId);
  if (selectedPath && toolMode === "edit-points") {
    for (const handle of collectHandles(selectedPath)) {
      const point = getHandlePoint(selectedPath, handle);
      drawHandle(point, selectedHandleId === handle.id);
    }
    for (const [index, segment] of selectedPath.segments.entries()) {
      if (segment.kind !== "bezier") continue;
      const end = segment.to;
      const prev = index === 0 ? selectedPath.start : selectedPath.segments[index - 1]!.to;
      ctx.save();
      ctx.strokeStyle = "#6b7280";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(segment.cp1.x, segment.cp1.y);
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(segment.cp2.x, segment.cp2.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  selectionView.textContent = JSON.stringify(
    {
      selectedPathId,
      selectedHandleId,
      mode: toolMode,
      pathCount: scene.paths.length,
    },
    null,
    2,
  );
  logView.textContent = JSON.stringify(interactionLog.slice(-12), null, 2);
};

sceneSelect.value = scene.id;
sceneSelect.addEventListener("change", () => {
  const next = getBuiltInScene(sceneSelect.value);
  if (!next) return;
  scene = next;
  selectedPathId = scene.paths[0]?.id ?? null;
  selectedHandleId = null;
  pushLog({ type: "scene-mutated", at: Date.now(), mutation: `load-scene:${scene.id}`, pathId: selectedPathId ?? "none" });
  pushLog({ type: "selection-changed", at: Date.now(), selectedPathId });
  render();
});

modeSelect.addEventListener("change", () => {
  toolMode = modeSelect.value === "edit-points" ? "edit-points" : "select";
  pushLog({ type: "tool-mode-changed", at: Date.now(), mode: toolMode });
  render();
});

toggleBounds.addEventListener("change", render);
toggleAnchors.addEventListener("change", render);
newPathButton.addEventListener("click", addNewPath);

addLineButton.addEventListener("click", () => {
  const path = getPathById(selectedPathId);
  if (!path) return;
  const from = path.segments[path.segments.length - 1]?.to ?? path.start;
  addSegmentToSelectedPath({ kind: "line", to: { x: from.x + 80, y: from.y + 20 } });
});

addBezierButton.addEventListener("click", () => {
  const path = getPathById(selectedPathId);
  if (!path) return;
  const from = path.segments[path.segments.length - 1]?.to ?? path.start;
  addSegmentToSelectedPath({
    kind: "bezier",
    cp1: { x: from.x + 40, y: from.y - 70 },
    cp2: { x: from.x + 120, y: from.y + 70 },
    to: { x: from.x + 160, y: from.y },
  });
});

addArcButton.addEventListener("click", () => {
  const path = getPathById(selectedPathId);
  if (!path) return;
  const from = path.segments[path.segments.length - 1]?.to ?? path.start;
  addSegmentToSelectedPath({
    kind: "arc",
    center: { x: from.x + 60, y: from.y },
    radius: 50,
    startAngle: 0,
    endAngle: Math.PI * 1.25,
    counterclockwise: false,
    to: { x: from.x + 20, y: from.y + 40 },
  });
});

exportButton.addEventListener("click", async () => {
  const payload = createBugCaseExport(scene, getToolState(), interactionLog);
  const text = serializeBugCaseExportWithDocumentString(payload);
  exportView.value = text;
  await navigator.clipboard.writeText(text).catch(() => undefined);
});

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  const point = pointerToCanvas(event);
  pointerDown = point;

  let target: string | null = null;
  if (toolMode === "edit-points") {
    const handle = hitHandle(point);
    if (handle) {
      selectedHandleId = handle.id;
      drag = { kind: "handle", handle };
      target = handle.id;
      pushLog({ type: "drag-start", at: Date.now(), kind: "handle", targetId: handle.id });
    }
  }

  if (!drag) {
    const pickedPathId = pickPath(point);
    selectedPathId = pickedPathId;
    selectedHandleId = null;
    target = pickedPathId;
    pushLog({ type: "selection-changed", at: Date.now(), selectedPathId });
    if (pickedPathId) {
      drag = { kind: "path", pathId: pickedPathId };
      pushLog({ type: "drag-start", at: Date.now(), kind: "path", targetId: pickedPathId });
    }
  }

  pushLog({ type: "pointer-down", at: Date.now(), x: point.x, y: point.y, target });
  render();
});

canvas.addEventListener("pointermove", (event) => {
  const point = pointerToCanvas(event);
  pushLog({ type: "pointer-move", at: Date.now(), x: point.x, y: point.y });

  if (!pointerDown || !drag) {
    return;
  }

  const dx = point.x - pointerDown.x;
  const dy = point.y - pointerDown.y;

  if (drag.kind === "path") {
    const path = getPathById(drag.pathId);
    if (path) {
      translatePath(path, dx, dy);
      pushLog({ type: "drag-move", at: Date.now(), kind: "path", targetId: drag.pathId, dx, dy });
      pushLog({ type: "scene-mutated", at: Date.now(), mutation: "translate-path", pathId: path.id });
    }
  } else {
    const path = getPathById(drag.handle.pathId);
    if (path) {
      const currentPoint = getHandlePoint(path, drag.handle);
      setHandlePoint(path, drag.handle, { x: currentPoint.x + dx, y: currentPoint.y + dy });
      pushLog({ type: "drag-move", at: Date.now(), kind: "handle", targetId: drag.handle.id, dx, dy });
      pushLog({ type: "scene-mutated", at: Date.now(), mutation: "move-handle", pathId: path.id });
    }
  }

  pointerDown = point;
  render();
});

canvas.addEventListener("pointerup", (event) => {
  const point = pointerToCanvas(event);
  pushLog({ type: "pointer-up", at: Date.now(), x: point.x, y: point.y });
  if (drag?.kind === "path") {
    pushLog({ type: "drag-end", at: Date.now(), kind: "path", targetId: drag.pathId });
  }
  if (drag?.kind === "handle") {
    pushLog({ type: "drag-end", at: Date.now(), kind: "handle", targetId: drag.handle.id });
  }
  pointerDown = null;
  drag = null;
  render();
});

render();
