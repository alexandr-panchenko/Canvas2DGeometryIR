import { GeometryEngine } from "../src/geometry";
import { createBugCaseExport, serializeBugCaseExportWithDocumentString } from "../src/playground/export";
import { builtInScenes, getBuiltInScene } from "../src/playground/fixtures";
import { resolveArcThroughPoint, sceneToDocument, syncSceneCommands } from "../src/playground/scene";
import { cloneScene } from "../src/playground/types";
import { closestPointOnSegment } from "../src/segments";
import type {
  InteractionEvent,
  PlaygroundScene,
  SceneCommand,
  ScenePaintMode,
  ScenePath,
  SceneSegment,
  SceneShape,
  SceneStyle,
  ToolStateSnapshot,
} from "../src/playground/types";
import type { Point, Rect, Segment } from "../src/types";

interface HandleRef {
  readonly id: string;
  readonly pathId: string;
  readonly segmentIndex: number;
  readonly role: "start" | "to" | "cp1" | "cp2" | "control";
}

type CreationState =
  | { readonly kind: "new-path" }
  | { readonly kind: "add-line"; readonly pathId: string }
  | { readonly kind: "add-arc"; readonly pathId: string; readonly end: Point | null }
  | { readonly kind: "add-bezier"; readonly pathId: string; readonly cp1: Point | null; readonly cp2: Point | null }
  | null;

type DragState =
  | { readonly kind: "path"; readonly pathId: string; lastPoint: Point; moved: boolean }
  | { readonly kind: "handle"; readonly handle: HandleRef; lastPoint: Point; moved: boolean }
  | null;

interface ClosestPathHover {
  readonly pathId: string;
  readonly point: Point;
  readonly distance: number;
  readonly segmentIndex: number;
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
    <label><input id="toggle-bounds" type="checkbox" checked /> Bounds</label>
    <label><input id="toggle-anchors" type="checkbox" checked /> Geometry anchors</label>
    <button id="export">Export Scene</button>
  </div>
  <div class="workspace">
    <aside class="sidebar">
      <section class="panel-card">
        <h3>Commands</h3>
        <div class="sidebar-actions">
          <button id="new-path">New Path</button>
          <button id="create-shape">Group Selection</button>
        </div>
        <div id="prompt-view" class="prompt-view"></div>
        <div id="command-tree" class="command-tree"></div>
      </section>
      <section class="panel-card">
        <h3>Status</h3>
        <pre id="selection-view"></pre>
      </section>
      <section class="panel-card">
        <h3>Export</h3>
        <textarea id="export-view" rows="12" spellcheck="false"></textarea>
      </section>
      <section class="panel-card">
        <h3>Click Log</h3>
        <pre id="log-view"></pre>
      </section>
    </aside>
    <section class="scene-panel">
      <canvas id="canvas" width="960" height="600"></canvas>
    </section>
  </div>
`;

const canvas = app.querySelector<HTMLCanvasElement>("#canvas");
const ctx = canvas?.getContext("2d");
const sceneSelect = app.querySelector<HTMLSelectElement>("#scene-select");
const selectionView = app.querySelector<HTMLPreElement>("#selection-view");
const commandTree = app.querySelector<HTMLDivElement>("#command-tree");
const promptView = app.querySelector<HTMLDivElement>("#prompt-view");
const exportView = app.querySelector<HTMLTextAreaElement>("#export-view");
const logView = app.querySelector<HTMLPreElement>("#log-view");
const toggleBounds = app.querySelector<HTMLInputElement>("#toggle-bounds");
const toggleAnchors = app.querySelector<HTMLInputElement>("#toggle-anchors");
const newPathButton = app.querySelector<HTMLButtonElement>("#new-path");
const createShapeButton = app.querySelector<HTMLButtonElement>("#create-shape");
const exportButton = app.querySelector<HTMLButtonElement>("#export");

if (
  !canvas ||
  !ctx ||
  !sceneSelect ||
  !selectionView ||
  !commandTree ||
  !promptView ||
  !exportView ||
  !logView ||
  !toggleBounds ||
  !toggleAnchors ||
  !newPathButton ||
  !createShapeButton ||
  !exportButton
) {
  throw new Error("UI wiring failed");
}

for (const builtIn of builtInScenes) {
  const option = document.createElement("option");
  option.value = builtIn.id;
  option.textContent = builtIn.name;
  sceneSelect.append(option);
}

let scene: PlaygroundScene = cloneScene(builtInScenes[0]!);
let selectedPathId: string | null = scene.paths[0]?.id ?? null;
let selectedPathIds = new Set<string>(selectedPathId ? [selectedPathId] : []);
let selectedHandleId: string | null = null;
let selectedCommandId: string | null = null;
let creationState: CreationState = null;
let drag: DragState = null;
let hoverPoint: Point | null = null;
const interactionLog: InteractionEvent[] = [];

const pushClickLog = (point: Point, target: InteractionEvent["target"]): void => {
  interactionLog.push({ type: "click", at: Date.now(), x: point.x, y: point.y, target });
  if (interactionLog.length > 80) {
    interactionLog.shift();
  }
};

const getToolState = (): ToolStateSnapshot => ({
  selectedPathId,
  selectedPathIds: [...selectedPathIds],
  selectedHandleId,
  selectedCommandId,
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

const nextId = (prefix: string, values: readonly string[]): string => {
  let counter = values.length + 1;
  while (values.includes(`${prefix}-${counter}`)) {
    counter += 1;
  }
  return `${prefix}-${counter}`;
};

const getPathById = (pathId: string | null): ScenePath | null => {
  if (!pathId) {
    return null;
  }
  return scene.paths.find((path) => path.id === pathId) ?? null;
};

const getShapeById = (shapeId: string | null): SceneShape | null => {
  if (!shapeId) {
    return null;
  }
  return scene.shapes.find((shape) => shape.id === shapeId) ?? null;
};

const getPathCurrentPoint = (path: ScenePath): Point => path.segments[path.segments.length - 1]?.to ?? path.start;

const pointDistance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

const getCommandForSegment = (pathId: string, segmentIndex: number): SceneCommand | null =>
  scene.commands.find(
    (command) =>
      ("pathId" in command && command.pathId === pathId && "segmentIndex" in command && command.segmentIndex === segmentIndex) ||
      (command.kind === "moveTo" && segmentIndex === -1 && command.pathId === pathId),
  ) ?? null;

const collectHandles = (path: ScenePath): HandleRef[] => {
  const handles: HandleRef[] = [{ id: `${path.id}:start`, pathId: path.id, segmentIndex: -1, role: "start" }];
  path.segments.forEach((segment, index) => {
    handles.push({ id: `${path.id}:${index}:to`, pathId: path.id, segmentIndex: index, role: "to" });
    if (segment.kind === "bezier") {
      handles.push({ id: `${path.id}:${index}:cp1`, pathId: path.id, segmentIndex: index, role: "cp1" });
      handles.push({ id: `${path.id}:${index}:cp2`, pathId: path.id, segmentIndex: index, role: "cp2" });
    }
    if (segment.kind === "arc") {
      handles.push({ id: `${path.id}:${index}:control`, pathId: path.id, segmentIndex: index, role: "control" });
    }
  });
  return handles;
};

const getHandlePoint = (path: ScenePath, handle: HandleRef): Point => {
  if (handle.role === "start") {
    return path.start;
  }
  const segment = path.segments[handle.segmentIndex];
  if (!segment) {
    return path.start;
  }
  if (handle.role === "to") {
    return segment.to;
  }
  if (segment.kind === "bezier" && handle.role === "cp1") {
    return segment.cp1;
  }
  if (segment.kind === "bezier" && handle.role === "cp2") {
    return segment.cp2;
  }
  if (segment.kind === "arc" && handle.role === "control") {
    return segment.control;
  }
  return segment.to;
};

const setHandlePoint = (path: ScenePath, handle: HandleRef, point: Point): void => {
  if (handle.role === "start") {
    path.start = point;
    return;
  }
  const segment = path.segments[handle.segmentIndex];
  if (!segment) {
    return;
  }
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
  if (segment.kind === "arc" && handle.role === "control") {
    segment.control = point;
  }
};

const hitHandle = (point: Point): HandleRef | null => {
  const path = getPathById(selectedPathId);
  if (!path) {
    return null;
  }
  for (const handle of collectHandles(path)) {
    const handlePoint = getHandlePoint(path, handle);
    if (Math.hypot(handlePoint.x - point.x, handlePoint.y - point.y) <= 9) {
      return handle;
    }
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
      control: { x: segment.control.x + dx, y: segment.control.y + dy },
      to: { x: segment.to.x + dx, y: segment.to.y + dy },
    };
  });
};

const getPathShape = (path: ScenePath): SceneShape | null => getShapeById(path.shapeId);

const getRenderStyle = (path: ScenePath): { style: SceneStyle; paint: ScenePaintMode } => {
  const shape = getPathShape(path);
  return shape ? { style: shape.style, paint: shape.paint } : { style: path.style, paint: path.paint };
};

const drawOverlayBounds = (bounds: Rect): void => {
  ctx.save();
  ctx.strokeStyle = "#14b8a6";
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1;
  ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  ctx.restore();
};

const drawHandle = (point: Point, kind: "anchor" | "control", active: boolean): void => {
  ctx.save();
  ctx.fillStyle = kind === "anchor" ? (active ? "#f59e0b" : "#0f766e") : active ? "#f59e0b" : "#be185d";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (kind === "anchor") {
    ctx.rect(point.x - 5, point.y - 5, 10, 10);
  } else {
    ctx.arc(point.x, point.y, 5.5, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

const drawClosestPointHighlight = (hover: ClosestPathHover): void => {
  const path = getPathById(hover.pathId);
  if (!path) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = "#0ea5e9";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.stroke(buildCanvasPath(path));
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#0ea5e9";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(hover.point.x, hover.point.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

const buildCanvasPath = (path: ScenePath): Path2D => {
  const shape = new Path2D();
  shape.moveTo(path.start.x, path.start.y);
  let current = path.start;
  for (const segment of path.segments) {
    if (segment.kind === "line") {
      shape.lineTo(segment.to.x, segment.to.y);
      current = segment.to;
      continue;
    }
    if (segment.kind === "bezier") {
      shape.bezierCurveTo(segment.cp1.x, segment.cp1.y, segment.cp2.x, segment.cp2.y, segment.to.x, segment.to.y);
      current = segment.to;
      continue;
    }
    const resolved = resolveArcThroughPoint(current, segment.control, segment.to);
    if (resolved) {
      shape.arc(resolved.center.x, resolved.center.y, resolved.radius, resolved.startAngle, resolved.endAngle, resolved.counterclockwise);
    } else {
      shape.lineTo(segment.to.x, segment.to.y);
    }
    current = segment.to;
  }
  if (path.closed) {
    shape.closePath();
  }
  return shape;
};

const drawPaint = (shape: Path2D, style: SceneStyle, paint: ScenePaintMode): void => {
  if (paint === "fill" || paint === "fill-stroke") {
    ctx.fillStyle = style.fillStyle;
    ctx.fill(shape);
  }
  if (paint === "stroke" || paint === "fill-stroke") {
    ctx.strokeStyle = style.strokeStyle;
    ctx.lineWidth = style.lineWidth;
    ctx.stroke(shape);
  }
};

const pickPath = (point: Point): string | null => {
  for (let index = scene.paths.length - 1; index >= 0; index -= 1) {
    const candidate = scene.paths[index]!;
    const shape = buildCanvasPath(candidate);
    const { style, paint } = getRenderStyle(candidate);
    const strokeWidth = Math.max(style.lineWidth + 8, 10);
    ctx.save();
    ctx.lineWidth = strokeWidth;
    const strokeHit = ctx.isPointInStroke(shape, point.x, point.y);
    const fillHit = (paint === "fill" || paint === "fill-stroke") && ctx.isPointInPath(shape, point.x, point.y);
    ctx.restore();
    if (strokeHit || fillHit) {
      return candidate.id;
    }
  }
  return null;
};

const getGeometrySegmentsForSceneSegment = (from: Point, segment: SceneSegment): Segment[] => {
  if (segment.kind === "line") {
    return [{ kind: "line", from, to: segment.to }];
  }
  if (segment.kind === "bezier") {
    return [{ kind: "bezier", from, cp1: segment.cp1, cp2: segment.cp2, to: segment.to }];
  }
  const resolved = resolveArcThroughPoint(from, segment.control, segment.to);
  if (resolved) {
    return [{
      kind: "arc",
      center: resolved.center,
      radius: resolved.radius,
      startAngle: resolved.startAngle,
      endAngle: resolved.endAngle,
      counterclockwise: resolved.counterclockwise,
    }];
  }
  return [{ kind: "line", from, to: segment.to }];
};

const findClosestPointOnPath = (path: ScenePath, target: Point): ClosestPathHover | null => {
  let current = path.start;
  let best: ClosestPathHover | null = null;

  path.segments.forEach((segment, segmentIndex) => {
    for (const geometrySegment of getGeometrySegmentsForSceneSegment(current, segment)) {
      const point = closestPointOnSegment(geometrySegment, target);
      const distance = pointDistance(point, target);
      if (best === null || distance < best.distance) {
        best = { pathId: path.id, point, distance, segmentIndex };
      }
    }
    current = segment.to;
  });

  return best;
};

const findClosestPathHover = (target: Point | null): ClosestPathHover | null => {
  if (!target) {
    return null;
  }

  let best: ClosestPathHover | null = null;
  for (const path of scene.paths) {
    const candidate = findClosestPointOnPath(path, target);
    if (candidate && (best === null || candidate.distance < best.distance)) {
      best = candidate;
    }
  }
  return best;
};

const setActivePath = (pathId: string | null, alsoToggleMulti = false): void => {
  selectedPathId = pathId;
  selectedHandleId = null;
  if (!pathId) {
    if (!alsoToggleMulti) {
      selectedPathIds.clear();
    }
    return;
  }
  if (alsoToggleMulti) {
    if (selectedPathIds.has(pathId)) {
      selectedPathIds.delete(pathId);
    } else {
      selectedPathIds.add(pathId);
    }
    if (selectedPathIds.size === 0) {
      selectedPathIds.add(pathId);
    }
  } else {
    selectedPathIds = new Set([pathId]);
  }
};

const selectShape = (shape: SceneShape): void => {
  const firstPathId = shape.pathIds[0] ?? null;
  setActivePath(firstPathId);
  selectedPathIds = new Set(shape.pathIds);
};

const startNewPath = (): void => {
  creationState = { kind: "new-path" };
  selectedHandleId = null;
  selectedCommandId = null;
};

const startSegmentCreation = (kind: "line" | "arc" | "bezier", pathId = selectedPathId): void => {
  const path = getPathById(pathId);
  if (!path || path.closed) {
    return;
  }
  setActivePath(path.id);
  selectedHandleId = null;
  selectedCommandId = null;
  if (kind === "line") {
    creationState = { kind: "add-line", pathId: path.id };
    return;
  }
  if (kind === "arc") {
    creationState = { kind: "add-arc", pathId: path.id, end: null };
    return;
  }
  creationState = { kind: "add-bezier", pathId: path.id, cp1: null, cp2: null };
};

const createPathAt = (start: Point): void => {
  const id = nextId("path", scene.paths.map((path) => path.id));
  scene.paths.push({
    id,
    name: `Path ${scene.paths.length + 1}`,
    style: { fillStyle: "rgba(37,99,235,0.18)", strokeStyle: "#2563eb", lineWidth: 3 },
    paint: "stroke",
    start,
    segments: [],
    closed: false,
    shapeId: null,
  });
  syncSceneCommands(scene);
  setActivePath(id);
  creationState = null;
};

const commitSegment = (path: ScenePath, segment: SceneSegment): void => {
  path.segments.push(segment);
  syncSceneCommands(scene);
  creationState = null;
};

const createShapeFromSelection = (): void => {
  const pathIds = scene.paths.map((path) => path.id).filter((id) => selectedPathIds.has(id));
  if (pathIds.length === 0) {
    return;
  }

  const shapeId = nextId("shape", scene.shapes.map((shape) => shape.id));
  const shape: SceneShape = {
    id: shapeId,
    name: `Shape ${scene.shapes.length + 1}`,
    pathIds,
    style: { fillStyle: "rgba(16,185,129,0.16)", strokeStyle: "#059669", lineWidth: 3 },
    paint: "fill-stroke",
  };

  scene.shapes = scene.shapes
    .map((entry) => ({
      ...entry,
      pathIds: entry.pathIds.filter((pathId) => !pathIds.includes(pathId)),
    }))
    .filter((entry) => entry.pathIds.length > 0);
  scene.shapes.push(shape);
  scene.paths.forEach((path) => {
    if (pathIds.includes(path.id)) {
      path.shapeId = shapeId;
    }
  });
  syncSceneCommands(scene);
  selectShape(shape);
};

const deleteShape = (shapeId: string): void => {
  scene.paths.forEach((path) => {
    if (path.shapeId === shapeId) {
      path.shapeId = null;
    }
  });
  scene.shapes = scene.shapes.filter((shape) => shape.id !== shapeId);
  syncSceneCommands(scene);
};

const detachPathFromShape = (pathId: string): void => {
  const path = getPathById(pathId);
  if (!path || !path.shapeId) {
    return;
  }
  const shapeId = path.shapeId;
  path.shapeId = null;
  scene.shapes = scene.shapes
    .map((shape) => (shape.id === shapeId ? { ...shape, pathIds: shape.pathIds.filter((candidate) => candidate !== pathId) } : shape))
    .filter((shape) => shape.pathIds.length > 0);
  syncSceneCommands(scene);
};

const deletePath = (pathId: string): void => {
  const path = getPathById(pathId);
  if (!path) {
    return;
  }
  if (path.shapeId) {
    const shapeId = path.shapeId;
    scene.shapes = scene.shapes
      .map((shape) => (shape.id === shapeId ? { ...shape, pathIds: shape.pathIds.filter((candidate) => candidate !== pathId) } : shape))
      .filter((shape) => shape.pathIds.length > 0);
  }
  scene.paths = scene.paths.filter((candidate) => candidate.id !== pathId);
  selectedPathIds.delete(pathId);
  if (selectedPathId === pathId) {
    selectedPathId = scene.paths[0]?.id ?? null;
    selectedPathIds = new Set(selectedPathId ? [selectedPathId] : []);
  }
  selectedCommandId = null;
  selectedHandleId = null;
  if (creationState && creationState.kind !== "new-path" && creationState.pathId === pathId) {
    creationState = null;
  }
  syncSceneCommands(scene);
};

const removeSegment = (pathId: string, segmentIndex: number): void => {
  const path = getPathById(pathId);
  if (!path) {
    return;
  }
  path.segments.splice(segmentIndex, 1);
  selectedCommandId = null;
  selectedHandleId = null;
  syncSceneCommands(scene);
};

const setPathClosed = (pathId: string, closed: boolean): void => {
  const path = getPathById(pathId);
  if (!path) {
    return;
  }
  path.closed = closed;
  if (closed && creationState && creationState.kind !== "new-path" && creationState.pathId === pathId) {
    creationState = null;
  }
  syncSceneCommands(scene);
};

const commandLabel = (command: SceneCommand): string => {
  switch (command.kind) {
    case "beginPath":
      return `beginPath(${command.targetType}:${command.targetId})`;
    case "moveTo":
      return `moveTo(${command.x.toFixed(1)}, ${command.y.toFixed(1)})`;
    case "lineTo":
      return `lineTo(${command.x.toFixed(1)}, ${command.y.toFixed(1)})`;
    case "bezierCurveTo":
      return `bezierCurveTo(${command.cp1.x.toFixed(1)}, ${command.cp1.y.toFixed(1)} ... ${command.to.x.toFixed(1)}, ${command.to.y.toFixed(1)})`;
    case "arc":
      return command.valid ? `arc(r=${command.radius?.toFixed(1) ?? "?"})` : "arc(degenerate)";
    case "closePath":
      return "closePath()";
    case "fill":
      return `fill(${command.targetId})`;
    case "stroke":
      return `stroke(${command.targetId})`;
  }
};

const getCreationPrompt = (): string | null => {
  if (!creationState) {
    return null;
  }
  if (creationState.kind === "new-path") {
    return "Click in the scene to place the new path start.";
  }
  if (creationState.kind === "add-line") {
    return "Click in the scene to place the line end point.";
  }
  if (creationState.kind === "add-arc") {
    return creationState.end === null
      ? "Click in the scene to place the arc end point."
      : "Click in the scene to place the arc control point.";
  }
  if (creationState.cp1 === null) {
    return "Click in the scene to place Bezier control point 1.";
  }
  if (creationState.cp2 === null) {
    return "Click in the scene to place Bezier control point 2.";
  }
  return "Click in the scene to place the Bezier end point.";
};

const updateSelectionFromCommand = (command: SceneCommand): void => {
  selectedCommandId = command.id;
  if ("pathId" in command) {
    setActivePath(command.pathId);
    return;
  }
  if (command.kind === "beginPath") {
    if (command.targetType === "path") {
      setActivePath(command.targetId);
      return;
    }
    const shape = getShapeById(command.targetId);
    if (shape) {
      selectShape(shape);
    }
  }
};

const createControlRow = (labelText: string, input: HTMLElement): HTMLLabelElement => {
  const row = document.createElement("label");
  row.className = "control-row";
  const label = document.createElement("span");
  label.textContent = labelText;
  row.append(label, input);
  return row;
};

const createColorInput = (value: string, fallback: string, onInput: (nextValue: string) => void): HTMLInputElement => {
  const input = document.createElement("input");
  input.type = "color";
  input.value = value.startsWith("#") ? value : fallback;
  input.addEventListener("input", () => {
    onInput(input.value);
    render();
  });
  return input;
};

const createNumberInput = (value: number, onInput: (nextValue: number) => void): HTMLInputElement => {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = "32";
  input.step = "1";
  input.value = String(value);
  input.addEventListener("input", () => {
    onInput(Math.max(1, Number(input.value) || 1));
    render();
  });
  return input;
};

const createPaintSelect = (value: ScenePaintMode, onChange: (nextValue: ScenePaintMode) => void): HTMLSelectElement => {
  const select = document.createElement("select");
  for (const optionValue of ["stroke", "fill", "fill-stroke"] as const) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionValue;
    option.selected = optionValue === value;
    select.append(option);
  }
  select.addEventListener("change", () => {
    onChange(select.value as ScenePaintMode);
    render();
  });
  return select;
};

const buildStyleEditor = (
  style: SceneStyle,
  paint: ScenePaintMode,
  onPaintChange: (nextPaint: ScenePaintMode) => void,
): HTMLDivElement => {
  const editor = document.createElement("div");
  editor.className = "style-editor";

  editor.append(
    createControlRow("Stroke", createColorInput(style.strokeStyle, "#2563eb", (nextValue) => {
      style.strokeStyle = nextValue;
    })),
    createControlRow("Fill", createColorInput(style.fillStyle, "#10b981", (nextValue) => {
      style.fillStyle = nextValue;
    })),
    createControlRow("Paint", createPaintSelect(paint, onPaintChange)),
    createControlRow("Line width", createNumberInput(style.lineWidth, (nextValue) => {
      style.lineWidth = nextValue;
    })),
  );

  return editor;
};

const buildCommandRow = (
  command: SceneCommand,
  options: { readonly onDelete?: () => void; readonly extraClassName?: string },
): HTMLDivElement => {
  const row = document.createElement("div");
  row.className = `command-row${command.id === selectedCommandId ? " selected" : ""}${options.extraClassName ? ` ${options.extraClassName}` : ""}`;

  const button = document.createElement("button");
  button.className = "command-label";
  button.textContent = commandLabel(command);
  button.addEventListener("click", () => {
    updateSelectionFromCommand(command);
    render();
  });
  row.append(button);

  if (options.onDelete) {
    const deleteButton = document.createElement("button");
    deleteButton.className = "danger-button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => {
      options.onDelete?.();
      render();
    });
    row.append(deleteButton);
  }

  return row;
};

const buildInsertRow = (path: ScenePath): HTMLDivElement => {
  const row = document.createElement("div");
  row.className = "command-row insert-row";

  const label = document.createElement("span");
  label.className = "insert-label";
  label.textContent = "Insert next";
  row.append(label);

  const buildInsertButton = (text: string, onClick: () => void): HTMLButtonElement => {
    const button = document.createElement("button");
    button.className = "insert-button";
    button.textContent = text;
    button.disabled = path.closed;
    button.addEventListener("click", () => {
      onClick();
      render();
    });
    return button;
  };

  row.append(
    buildInsertButton("Line", () => startSegmentCreation("line", path.id)),
    buildInsertButton("Curve", () => startSegmentCreation("bezier", path.id)),
    buildInsertButton("Arc", () => startSegmentCreation("arc", path.id)),
    buildInsertButton("Close", () => setPathClosed(path.id, true)),
  );

  return row;
};

const buildPathCard = (path: ScenePath, level: "root" | "nested"): HTMLDivElement => {
  const card = document.createElement("div");
  card.className = `tree-card path-card${path.id === selectedPathId ? " selected" : ""}${level === "nested" ? " nested" : ""}`;

  const header = document.createElement("div");
  header.className = "tree-header";

  const titleGroup = document.createElement("div");
  titleGroup.className = "tree-title-group";

  const multiSelect = document.createElement("input");
  multiSelect.type = "checkbox";
  multiSelect.checked = selectedPathIds.has(path.id);
  multiSelect.addEventListener("change", () => {
    setActivePath(path.id, true);
    render();
  });

  const titleButton = document.createElement("button");
  titleButton.className = "tree-title";
  titleButton.textContent = path.name;
  titleButton.addEventListener("click", () => {
    setActivePath(path.id);
    render();
  });

  const meta = document.createElement("span");
  meta.className = "tree-meta";
  meta.textContent = path.closed ? "closed" : `${path.segments.length} segment${path.segments.length === 1 ? "" : "s"}`;

  titleGroup.append(multiSelect, titleButton, meta);

  const actions = document.createElement("div");
  actions.className = "tree-actions";

  if (path.shapeId) {
    const detachButton = document.createElement("button");
    detachButton.textContent = "Detach";
    detachButton.addEventListener("click", () => {
      detachPathFromShape(path.id);
      render();
    });
    actions.append(detachButton);
  }

  const deleteButton = document.createElement("button");
  deleteButton.className = "danger-button";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => {
    deletePath(path.id);
    render();
  });

  if (path.closed) {
    const reopenButton = document.createElement("button");
    reopenButton.textContent = "Open";
    reopenButton.addEventListener("click", () => {
      setPathClosed(path.id, false);
      render();
    });
    actions.append(reopenButton);
  }

  actions.append(deleteButton);
  header.append(titleGroup, actions);
  card.append(header);

  if (!path.shapeId) {
    card.append(
      buildStyleEditor(path.style, path.paint, (nextPaint) => {
        path.paint = nextPaint;
      }),
    );
  } else {
    const inherited = document.createElement("div");
    inherited.className = "inherited-note";
    const shape = getShapeById(path.shapeId);
    inherited.textContent = `Uses ${shape?.name ?? "shape"} paint controls.`;
    card.append(inherited);
  }

  const commands = document.createElement("div");
  commands.className = "command-stack";
  const moveToCommand = scene.commands.find((command) => command.kind === "moveTo" && command.pathId === path.id);
  if (moveToCommand) {
    commands.append(buildCommandRow(moveToCommand, {}));
  }
  path.segments.forEach((_, segmentIndex) => {
    const command = getCommandForSegment(path.id, segmentIndex);
    if (command) {
      commands.append(buildCommandRow(command, { onDelete: () => removeSegment(path.id, segmentIndex) }));
    }
  });
  if (!path.closed) {
    commands.append(buildInsertRow(path));
  } else {
    const closeCommand = scene.commands.find((command) => command.kind === "closePath" && command.pathId === path.id);
    if (closeCommand) {
      commands.append(buildCommandRow(closeCommand, { onDelete: () => setPathClosed(path.id, false), extraClassName: "close-command" }));
    }
  }
  card.append(commands);

  return card;
};

const renderCommandTree = (): void => {
  commandTree.innerHTML = "";

  for (const shape of scene.shapes) {
    const shapeCard = document.createElement("div");
    shapeCard.className = `tree-card shape-card${shape.pathIds.includes(selectedPathId ?? "") ? " selected" : ""}`;

    const header = document.createElement("div");
    header.className = "tree-header";

    const titleGroup = document.createElement("div");
    titleGroup.className = "tree-title-group";

    const titleButton = document.createElement("button");
    titleButton.className = "tree-title";
    titleButton.textContent = shape.name;
    titleButton.addEventListener("click", () => {
      selectShape(shape);
      render();
    });

    const meta = document.createElement("span");
    meta.className = "tree-meta";
    meta.textContent = `${shape.pathIds.length} path${shape.pathIds.length === 1 ? "" : "s"}`;

    titleGroup.append(titleButton, meta);

    const actions = document.createElement("div");
    actions.className = "tree-actions";
    const deleteButton = document.createElement("button");
    deleteButton.className = "danger-button";
    deleteButton.textContent = "Delete Shape";
    deleteButton.addEventListener("click", () => {
      deleteShape(shape.id);
      render();
    });
    actions.append(deleteButton);

    header.append(titleGroup, actions);
    shapeCard.append(header);

    shapeCard.append(
      buildStyleEditor(shape.style, shape.paint, (nextPaint) => {
        shape.paint = nextPaint;
      }),
    );

    const beginCommand = scene.commands.find(
      (command) => command.kind === "beginPath" && command.targetType === "shape" && command.targetId === shape.id,
    );
    if (beginCommand) {
      shapeCard.append(buildCommandRow(beginCommand, {}));
    }

    const nestedPaths = document.createElement("div");
    nestedPaths.className = "nested-paths";
    for (const pathId of shape.pathIds) {
      const path = getPathById(pathId);
      if (path) {
        nestedPaths.append(buildPathCard(path, "nested"));
      }
    }
    shapeCard.append(nestedPaths);

    const paintCommands = scene.commands.filter(
      (command) => ("targetId" in command) && command.targetId === shape.id && (command.kind === "fill" || command.kind === "stroke"),
    );
    for (const command of paintCommands) {
      shapeCard.append(buildCommandRow(command, {}));
    }

    commandTree.append(shapeCard);
  }

  const ungroupedPaths = scene.paths.filter((path) => path.shapeId === null);
  if (ungroupedPaths.length > 0) {
    for (const path of ungroupedPaths) {
      const pathCard = buildPathCard(path, "root");
      const beginCommand = scene.commands.find(
        (command) => command.kind === "beginPath" && command.targetType === "path" && command.targetId === path.id,
      );
      if (beginCommand) {
        pathCard.insertBefore(buildCommandRow(beginCommand, {}), pathCard.children[1] ?? null);
      }
      const paintCommands = scene.commands.filter(
        (command) => ("targetId" in command) && command.targetId === path.id && (command.kind === "fill" || command.kind === "stroke"),
      );
      for (const command of paintCommands) {
        pathCard.append(buildCommandRow(command, {}));
      }
      commandTree.append(pathCard);
    }
  }

  if (scene.shapes.length === 0 && ungroupedPaths.length === 0) {
    commandTree.textContent = "No paths yet. Start a new path and click in the scene to place it.";
  }
};

const drawSegmentGuides = (path: ScenePath): void => {
  let previous = path.start;
  path.segments.forEach((segment) => {
    if (segment.kind === "bezier") {
      ctx.save();
      ctx.strokeStyle = "#9ca3af";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(segment.cp1.x, segment.cp1.y);
      ctx.moveTo(segment.to.x, segment.to.y);
      ctx.lineTo(segment.cp2.x, segment.cp2.y);
      ctx.stroke();
      ctx.restore();
    }
    if (segment.kind === "arc") {
      ctx.save();
      ctx.strokeStyle = "#f9a8d4";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(segment.control.x, segment.control.y);
      ctx.lineTo(segment.to.x, segment.to.y);
      ctx.stroke();
      ctx.restore();
    }
    previous = segment.to;
  });
};

const buildPreviewPath = (): Path2D | null => {
  if (!creationState || !hoverPoint) {
    return null;
  }
  if (creationState.kind === "new-path") {
    return null;
  }
  const path = getPathById(creationState.pathId);
  if (!path) {
    return null;
  }

  const previewPath = buildCanvasPath(path);
  const from = getPathCurrentPoint(path);
  if (creationState.kind === "add-line") {
    previewPath.lineTo(hoverPoint.x, hoverPoint.y);
    return previewPath;
  }
  if (creationState.kind === "add-arc") {
    if (creationState.end === null) {
      previewPath.lineTo(hoverPoint.x, hoverPoint.y);
      return previewPath;
    }
    const resolved = resolveArcThroughPoint(from, hoverPoint, creationState.end);
    if (resolved) {
      previewPath.arc(resolved.center.x, resolved.center.y, resolved.radius, resolved.startAngle, resolved.endAngle, resolved.counterclockwise);
    } else {
      previewPath.lineTo(creationState.end.x, creationState.end.y);
    }
    return previewPath;
  }
  if (creationState.cp1 === null) {
    previewPath.bezierCurveTo(hoverPoint.x, hoverPoint.y, hoverPoint.x, hoverPoint.y, hoverPoint.x, hoverPoint.y);
    return previewPath;
  }
  if (creationState.cp2 === null) {
    previewPath.bezierCurveTo(
      creationState.cp1.x,
      creationState.cp1.y,
      hoverPoint.x,
      hoverPoint.y,
      hoverPoint.x,
      hoverPoint.y,
    );
    return previewPath;
  }
  previewPath.bezierCurveTo(
    creationState.cp1.x,
    creationState.cp1.y,
    creationState.cp2.x,
    creationState.cp2.y,
    hoverPoint.x,
    hoverPoint.y,
  );
  return previewPath;
};

const render = (): void => {
  syncSceneCommands(scene);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const hoverClosestPath = findClosestPathHover(hoverPoint);

  const renderedShapes = new Set<string>();
  for (const path of scene.paths) {
    if (path.shapeId) {
      const shape = getShapeById(path.shapeId);
      if (!shape || renderedShapes.has(shape.id)) {
        continue;
      }
      renderedShapes.add(shape.id);
      const combined = new Path2D();
      scene.paths
        .filter((entry) => entry.shapeId === shape.id)
        .forEach((entry) => combined.addPath(buildCanvasPath(entry)));
      drawPaint(combined, shape.style, shape.paint);
      continue;
    }
    drawPaint(buildCanvasPath(path), path.style, path.paint);
  }

  const selectedPath = getPathById(selectedPathId);
  if (selectedPath) {
    ctx.save();
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.stroke(buildCanvasPath(selectedPath));
    ctx.restore();

    drawSegmentGuides(selectedPath);
    for (const handle of collectHandles(selectedPath)) {
      const point = getHandlePoint(selectedPath, handle);
      drawHandle(point, handle.role === "cp1" || handle.role === "cp2" || handle.role === "control" ? "control" : "anchor", handle.id === selectedHandleId);
    }
  }

  if (hoverClosestPath) {
    drawClosestPointHighlight(hoverClosestPath);
  }

  const document = sceneToDocument(scene);
  const engine = new GeometryEngine(document);

  if (toggleBounds.checked) {
    const bounds = engine.getBounds();
    if (bounds) {
      drawOverlayBounds(bounds);
    }
  }

  if (toggleAnchors.checked) {
    ctx.save();
    ctx.fillStyle = "#1d4ed8";
    for (const anchor of engine.getAnchorCandidates()) {
      ctx.beginPath();
      ctx.arc(anchor.point.x, anchor.point.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const previewPath = buildPreviewPath();
  if (previewPath) {
    ctx.save();
    ctx.strokeStyle = "#7c3aed";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.stroke(previewPath);
    ctx.restore();
  } else if (creationState?.kind === "new-path" && hoverPoint) {
    drawHandle(hoverPoint, "anchor", true);
  }

  promptView.textContent = getCreationPrompt() ?? "Select a path or shape from the command tree, or use the canvas directly.";
  selectionView.textContent = JSON.stringify(
    {
      selectedPathId,
      selectedPathIds: [...selectedPathIds],
      selectedHandleId,
      selectedCommandId,
      creation: creationState?.kind ?? null,
      prompt: getCreationPrompt(),
      hoverPoint,
      hoverClosestPath: hoverClosestPath
        ? {
            pathId: hoverClosestPath.pathId,
            segmentIndex: hoverClosestPath.segmentIndex,
            point: hoverClosestPath.point,
            distance: Number(hoverClosestPath.distance.toFixed(2)),
          }
        : null,
      pathCount: scene.paths.length,
      shapeCount: scene.shapes.length,
      commandCount: scene.commands.length,
    },
    null,
    2,
  );
  logView.textContent = JSON.stringify(interactionLog, null, 2);
  renderCommandTree();
};

sceneSelect.value = scene.id;

sceneSelect.addEventListener("change", () => {
  const next = getBuiltInScene(sceneSelect.value);
  if (!next) {
    return;
  }
  scene = next;
  selectedPathId = scene.paths[0]?.id ?? null;
  selectedPathIds = new Set(selectedPathId ? [selectedPathId] : []);
  selectedHandleId = null;
  selectedCommandId = null;
  creationState = null;
  hoverPoint = null;
  interactionLog.length = 0;
  render();
});

toggleBounds.addEventListener("change", render);
toggleAnchors.addEventListener("change", render);
newPathButton.addEventListener("click", () => {
  startNewPath();
  render();
});
createShapeButton.addEventListener("click", () => {
  createShapeFromSelection();
  render();
});
exportButton.addEventListener("click", async () => {
  const payload = createBugCaseExport(scene, getToolState(), interactionLog);
  const text = serializeBugCaseExportWithDocumentString(payload);
  exportView.value = text;
  await navigator.clipboard.writeText(text).catch(() => undefined);
});

canvas.addEventListener("pointermove", (event) => {
  hoverPoint = pointerToCanvas(event);
  if (!drag) {
    render();
    return;
  }

  const point = hoverPoint;
  const dx = point.x - drag.lastPoint.x;
  const dy = point.y - drag.lastPoint.y;
  if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
    drag.moved = true;
  }

  if (drag.kind === "path") {
    const path = getPathById(drag.pathId);
    if (path) {
      translatePath(path, dx, dy);
      selectedCommandId = null;
    }
  } else {
    const path = getPathById(drag.handle.pathId);
    if (path) {
      setHandlePoint(path, drag.handle, {
        x: getHandlePoint(path, drag.handle).x + dx,
        y: getHandlePoint(path, drag.handle).y + dy,
      });
      selectedHandleId = drag.handle.id;
      selectedCommandId = getCommandForSegment(drag.handle.pathId, drag.handle.segmentIndex)?.id ?? selectedCommandId;
    }
  }
  drag.lastPoint = point;
  render();
});

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  const point = pointerToCanvas(event);
  hoverPoint = point;

  if (creationState?.kind === "new-path") {
    createPathAt(point);
    render();
    return;
  }

  if (creationState) {
    const path = getPathById(creationState.pathId);
    if (!path) {
      creationState = null;
      render();
      return;
    }
    if (creationState.kind === "add-line") {
      commitSegment(path, { kind: "line", to: point });
      selectedCommandId = getCommandForSegment(path.id, path.segments.length - 1)?.id ?? null;
      render();
      return;
    }
    if (creationState.kind === "add-arc") {
      if (creationState.end === null) {
        creationState = { ...creationState, end: point };
      } else {
        commitSegment(path, { kind: "arc", control: point, to: creationState.end });
        selectedCommandId = getCommandForSegment(path.id, path.segments.length - 1)?.id ?? null;
      }
      render();
      return;
    }
    if (creationState.cp1 === null) {
      creationState = { ...creationState, cp1: point };
      render();
      return;
    }
    if (creationState.cp2 === null) {
      creationState = { ...creationState, cp2: point };
      render();
      return;
    }
    commitSegment(path, {
      kind: "bezier",
      cp1: creationState.cp1,
      cp2: creationState.cp2,
      to: point,
    });
    selectedCommandId = getCommandForSegment(path.id, path.segments.length - 1)?.id ?? null;
    render();
    return;
  }

  const handle = hitHandle(point);
  if (handle) {
    selectedHandleId = handle.id;
    selectedCommandId = getCommandForSegment(handle.pathId, handle.segmentIndex)?.id ?? selectedCommandId;
    drag = { kind: "handle", handle, lastPoint: point, moved: false };
    render();
    return;
  }

  const pathId = pickPath(point);
  setActivePath(pathId);
  selectedCommandId = null;
  if (pathId) {
    drag = { kind: "path", pathId, lastPoint: point, moved: false };
  }
  render();
});

canvas.addEventListener("pointerup", (event) => {
  const point = pointerToCanvas(event);
  hoverPoint = point;

  if (!drag) {
    pushClickLog(point, pickPath(point) ? "path" : "empty");
    render();
    return;
  }

  if (!drag.moved) {
    pushClickLog(point, drag.kind === "handle" ? "control-point" : "path");
  }
  drag = null;
  render();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    creationState = null;
    drag = null;
    render();
  }
});

render();
