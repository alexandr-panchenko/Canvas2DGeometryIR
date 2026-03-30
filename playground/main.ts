import { GeometryEngine } from "../src/geometry";
import { createBugCaseExport, serializeBugCaseExportWithDocumentString } from "../src/playground/export";
import { builtInScenes, getBuiltInScene } from "../src/playground/fixtures";
import { resolveArcThroughPoint, sceneToDocument, syncSceneCommands } from "../src/playground/scene";
import { cloneScene } from "../src/playground/types";
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
import type { Point, Rect } from "../src/types";

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
    <button id="add-bezier">Add Bezier</button>
    <button id="add-arc">Add Arc</button>
    <button id="create-shape">Create Shape</button>
    <label><input id="toggle-bounds" type="checkbox" checked /> Bounds</label>
    <label><input id="toggle-anchors" type="checkbox" checked /> Geometry anchors</label>
    <button id="export">Export Scene</button>
  </div>
  <div class="main">
    <canvas id="canvas" width="960" height="600"></canvas>
    <div class="panel">
      <section>
        <h3>Status</h3>
        <pre id="selection-view"></pre>
      </section>
      <section>
        <h3>Inspector</h3>
        <div id="inspector"></div>
      </section>
      <section>
        <h3>Paths</h3>
        <div id="path-list" class="list"></div>
      </section>
      <section>
        <h3>Shapes</h3>
        <div id="shape-list" class="list"></div>
      </section>
      <section>
        <h3>Commands</h3>
        <div id="command-list" class="list command-list"></div>
      </section>
      <section>
        <h3>Export</h3>
        <textarea id="export-view" rows="14" spellcheck="false"></textarea>
      </section>
      <section>
        <h3>Click log</h3>
        <pre id="log-view"></pre>
      </section>
    </div>
  </div>
`;

const canvas = app.querySelector<HTMLCanvasElement>("#canvas");
const ctx = canvas?.getContext("2d");
const sceneSelect = app.querySelector<HTMLSelectElement>("#scene-select");
const selectionView = app.querySelector<HTMLPreElement>("#selection-view");
const inspector = app.querySelector<HTMLDivElement>("#inspector");
const pathList = app.querySelector<HTMLDivElement>("#path-list");
const shapeList = app.querySelector<HTMLDivElement>("#shape-list");
const commandList = app.querySelector<HTMLDivElement>("#command-list");
const exportView = app.querySelector<HTMLTextAreaElement>("#export-view");
const logView = app.querySelector<HTMLPreElement>("#log-view");
const toggleBounds = app.querySelector<HTMLInputElement>("#toggle-bounds");
const toggleAnchors = app.querySelector<HTMLInputElement>("#toggle-anchors");
const newPathButton = app.querySelector<HTMLButtonElement>("#new-path");
const addLineButton = app.querySelector<HTMLButtonElement>("#add-line");
const addBezierButton = app.querySelector<HTMLButtonElement>("#add-bezier");
const addArcButton = app.querySelector<HTMLButtonElement>("#add-arc");
const createShapeButton = app.querySelector<HTMLButtonElement>("#create-shape");
const exportButton = app.querySelector<HTMLButtonElement>("#export");

if (
  !canvas ||
  !ctx ||
  !sceneSelect ||
  !selectionView ||
  !inspector ||
  !pathList ||
  !shapeList ||
  !commandList ||
  !exportView ||
  !logView ||
  !toggleBounds ||
  !toggleAnchors ||
  !newPathButton ||
  !addLineButton ||
  !addBezierButton ||
  !addArcButton ||
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

const startNewPath = (): void => {
  creationState = { kind: "new-path" };
  selectedHandleId = null;
  selectedCommandId = null;
};

const startSegmentCreation = (kind: "line" | "arc" | "bezier"): void => {
  const path = getPathById(selectedPathId);
  if (!path) {
    return;
  }
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
    return "Click to place the new path start.";
  }
  if (creationState.kind === "add-line") {
    return "Click to place the line end point.";
  }
  if (creationState.kind === "add-arc") {
    return creationState.end === null
      ? "Click to place the arc end point."
      : "Click to place the arc control point.";
  }
  if (creationState.cp1 === null) {
    return "Click to place Bezier control point 1.";
  }
  if (creationState.cp2 === null) {
    return "Click to place Bezier control point 2.";
  }
  return "Click to place the Bezier end point.";
};

const updateSelectionFromCommand = (command: SceneCommand): void => {
  selectedCommandId = command.id;
  if ("pathId" in command) {
    setActivePath(command.pathId);
    return;
  }
  if (command.kind === "beginPath" && command.targetType === "path") {
    setActivePath(command.targetId);
  }
};

const renderInspector = (): void => {
  const path = getPathById(selectedPathId);
  const shape = path ? getPathShape(path) : null;
  const targetStyle = shape?.style ?? path?.style ?? null;
  const targetPaint = shape?.paint ?? path?.paint ?? null;

  inspector.innerHTML = "";
  if (!targetStyle || !targetPaint) {
    inspector.textContent = "Select a path to edit paint and grouping.";
    return;
  }

  const title = document.createElement("div");
  title.className = "inspector-title";
  title.textContent = shape ? `Editing ${shape.name}` : `Editing ${path?.name ?? "Path"}`;

  const strokeRow = document.createElement("label");
  strokeRow.className = "inspector-row";
  strokeRow.textContent = "Stroke";
  const strokeInput = document.createElement("input");
  strokeInput.type = "color";
  strokeInput.value = targetStyle.strokeStyle.startsWith("#") ? targetStyle.strokeStyle : "#2563eb";
  strokeInput.addEventListener("input", () => {
    targetStyle.strokeStyle = strokeInput.value;
    render();
  });
  strokeRow.append(strokeInput);

  const fillRow = document.createElement("label");
  fillRow.className = "inspector-row";
  fillRow.textContent = "Fill";
  const fillInput = document.createElement("input");
  fillInput.type = "color";
  fillInput.value = targetStyle.fillStyle.startsWith("#") ? targetStyle.fillStyle : "#10b981";
  fillInput.addEventListener("input", () => {
    targetStyle.fillStyle = fillInput.value;
    render();
  });
  fillRow.append(fillInput);

  const paintRow = document.createElement("label");
  paintRow.className = "inspector-row";
  paintRow.textContent = "Paint";
  const paintSelect = document.createElement("select");
  for (const value of ["stroke", "fill", "fill-stroke"] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === targetPaint;
    paintSelect.append(option);
  }
  paintSelect.addEventListener("change", () => {
    const nextPaint = paintSelect.value as ScenePaintMode;
    if (shape) {
      shape.paint = nextPaint;
    } else if (path) {
      path.paint = nextPaint;
    }
    render();
  });
  paintRow.append(paintSelect);

  const widthRow = document.createElement("label");
  widthRow.className = "inspector-row";
  widthRow.textContent = "Line width";
  const widthInput = document.createElement("input");
  widthInput.type = "number";
  widthInput.min = "1";
  widthInput.max = "32";
  widthInput.step = "1";
  widthInput.value = String(targetStyle.lineWidth);
  widthInput.addEventListener("input", () => {
    targetStyle.lineWidth = Math.max(1, Number(widthInput.value) || 1);
    render();
  });
  widthRow.append(widthInput);

  inspector.append(title, strokeRow, fillRow, paintRow, widthRow);
};

const renderLists = (): void => {
  pathList.innerHTML = "";
  for (const path of scene.paths) {
    const row = document.createElement("div");
    row.className = `list-row${path.id === selectedPathId ? " selected" : ""}`;

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = selectedPathIds.has(path.id);
    toggle.addEventListener("change", () => {
      setActivePath(path.id, true);
      render();
    });

    const button = document.createElement("button");
    button.className = "list-button";
    button.textContent = `${path.name}${path.shapeId ? " [" + path.shapeId + "]" : ""}`;
    button.addEventListener("click", () => {
      setActivePath(path.id);
      render();
    });

    row.append(toggle, button);
    pathList.append(row);
  }

  shapeList.innerHTML = "";
  if (scene.shapes.length === 0) {
    shapeList.textContent = "No grouped shapes yet.";
  } else {
    for (const shape of scene.shapes) {
      const row = document.createElement("div");
      row.className = "list-row";
      const button = document.createElement("button");
      button.className = "list-button";
      button.textContent = `${shape.name}: ${shape.pathIds.join(", ")}`;
      button.addEventListener("click", () => {
        const firstPathId = shape.pathIds[0] ?? null;
        setActivePath(firstPathId);
        selectedPathIds = new Set(shape.pathIds);
        render();
      });
      row.append(button);
      shapeList.append(row);
    }
  }

  commandList.innerHTML = "";
  for (const command of scene.commands) {
    const button = document.createElement("button");
    button.className = `list-button command-button${command.id === selectedCommandId ? " selected" : ""}`;
    button.textContent = commandLabel(command);
    button.addEventListener("click", () => {
      updateSelectionFromCommand(command);
      render();
    });
    commandList.append(button);
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

  selectionView.textContent = JSON.stringify(
    {
      selectedPathId,
      selectedPathIds: [...selectedPathIds],
      selectedHandleId,
      selectedCommandId,
      creation: creationState?.kind ?? null,
      prompt: getCreationPrompt(),
      pathCount: scene.paths.length,
      shapeCount: scene.shapes.length,
      commandCount: scene.commands.length,
    },
    null,
    2,
  );
  logView.textContent = JSON.stringify(interactionLog, null, 2);
  renderInspector();
  renderLists();
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
addLineButton.addEventListener("click", () => {
  startSegmentCreation("line");
  render();
});
addBezierButton.addEventListener("click", () => {
  startSegmentCreation("bezier");
  render();
});
addArcButton.addEventListener("click", () => {
  startSegmentCreation("arc");
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
