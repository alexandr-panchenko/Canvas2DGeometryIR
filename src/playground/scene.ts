import { Canvas2DGeometryIRContext } from "../context";
import type { GeometryDocument, Point } from "../types";
import type { PlaygroundScene, SceneCommand, ScenePaintMode, ScenePath, SceneShape, SceneStyle } from "./types";

export interface ResolvedArcSegment {
  readonly center: Point;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly counterclockwise: boolean;
}

const distanceSquared = (a: Point, b: Point): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

const normalizedPositiveAngle = (angle: number): number => {
  const fullTurn = Math.PI * 2;
  const normalized = angle % fullTurn;
  return normalized < 0 ? normalized + fullTurn : normalized;
};

const curveThroughPointsTension = 0.5;

type CurveThroughPointsGeometrySegment =
  | { readonly kind: "line"; readonly from: Point; readonly to: Point }
  | { readonly kind: "bezier"; readonly from: Point; readonly cp1: Point; readonly cp2: Point; readonly to: Point };

export const resolveCurveThroughPointsSegments = (start: Point, points: readonly Point[]): CurveThroughPointsGeometrySegment[] => {
  const anchors = [start, ...points];
  if (anchors.length < 2) {
    return [];
  }
  if (anchors.length === 2) {
    return [{ kind: "line", from: anchors[0]!, to: anchors[1]! }];
  }

  const segments: CurveThroughPointsGeometrySegment[] = [];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const from = anchors[index]!;
    const to = anchors[index + 1]!;
    const previous = anchors[index - 1] ?? from;
    const next = anchors[index + 2] ?? to;
    const cp1 = {
      x: from.x + ((to.x - previous.x) * curveThroughPointsTension) / 6,
      y: from.y + ((to.y - previous.y) * curveThroughPointsTension) / 6,
    };
    const cp2 = {
      x: to.x - ((next.x - from.x) * curveThroughPointsTension) / 6,
      y: to.y - ((next.y - from.y) * curveThroughPointsTension) / 6,
    };
    segments.push({ kind: "bezier", from, cp1, cp2, to });
  }
  return segments;
};

const appendCurveThroughPointsToContext = (
  context: Canvas2DGeometryIRContext,
  start: Point,
  points: readonly Point[],
): void => {
  const segments = resolveCurveThroughPointsSegments(start, points);
  for (const segment of segments) {
    if (segment.kind === "line") {
      context.lineTo(segment.to.x, segment.to.y);
      continue;
    }
    context.bezierCurveTo(
      segment.cp1.x,
      segment.cp1.y,
      segment.cp2.x,
      segment.cp2.y,
      segment.to.x,
      segment.to.y,
    );
  }
};

export const resolveArcThroughPoint = (start: Point, control: Point, end: Point): ResolvedArcSegment | null => {
  const ax = start.x;
  const ay = start.y;
  const bx = control.x;
  const by = control.y;
  const cx = end.x;
  const cy = end.y;

  const determinant = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(determinant) < 1e-5) {
    return null;
  }

  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const center = {
    x: (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / determinant,
    y: (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / determinant,
  };

  const radius = Math.sqrt(distanceSquared(center, start));
  if (!Number.isFinite(radius) || radius < 1e-5) {
    return null;
  }

  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const controlAngle = Math.atan2(control.y - center.y, control.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);

  const forwardSpan = normalizedPositiveAngle(endAngle - startAngle);
  const controlForwardSpan = normalizedPositiveAngle(controlAngle - startAngle);
  const counterclockwise = controlForwardSpan > forwardSpan;

  return { center, radius, startAngle, endAngle, counterclockwise };
};

const applyPaintCommands = (
  commands: SceneCommand[],
  targetId: string,
  style: SceneStyle,
  paint: ScenePaintMode,
  commandIndex: { value: number },
): void => {
  if (paint === "fill" || paint === "fill-stroke") {
    commands.push({
      id: `cmd-${commandIndex.value}`,
      kind: "fill",
      targetId,
      style: { ...style },
    });
    commandIndex.value += 1;
  }
  if (paint === "stroke" || paint === "fill-stroke") {
    commands.push({
      id: `cmd-${commandIndex.value}`,
      kind: "stroke",
      targetId,
      style: { ...style },
    });
    commandIndex.value += 1;
  }
};

const pushPathCommands = (
  commands: SceneCommand[],
  path: ScenePath,
  commandIndex: { value: number },
  options: { readonly includeBeginPath: boolean; readonly targetId: string; readonly targetType: "path" | "shape" },
): void => {
  if (options.includeBeginPath) {
    commands.push({
      id: `cmd-${commandIndex.value}`,
      kind: "beginPath",
      targetId: options.targetId,
      targetType: options.targetType,
    });
    commandIndex.value += 1;
  }

  commands.push({
    id: `cmd-${commandIndex.value}`,
    kind: "moveTo",
    x: path.start.x,
    y: path.start.y,
    pathId: path.id,
  });
  commandIndex.value += 1;

  let current = path.start;
  path.segments.forEach((segment, segmentIndex) => {
    if (segment.kind === "line") {
      commands.push({
        id: `cmd-${commandIndex.value}`,
        kind: "lineTo",
        x: segment.to.x,
        y: segment.to.y,
        pathId: path.id,
        segmentIndex,
      });
      current = segment.to;
      commandIndex.value += 1;
      return;
    }

    if (segment.kind === "bezier") {
      commands.push({
        id: `cmd-${commandIndex.value}`,
        kind: "bezierCurveTo",
        cp1: { ...segment.cp1 },
        cp2: { ...segment.cp2 },
        to: { ...segment.to },
        pathId: path.id,
        segmentIndex,
      });
      current = segment.to;
      commandIndex.value += 1;
      return;
    }

    if (segment.kind === "curveThroughPoints") {
      commands.push({
        id: `cmd-${commandIndex.value}`,
        kind: "curveThroughPoints",
        points: segment.points.map((point) => ({ ...point })),
        pathId: path.id,
        segmentIndex,
      });
      current = segment.to;
      commandIndex.value += 1;
      return;
    }

    const resolved = resolveArcThroughPoint(current, segment.control, segment.to);
    commands.push({
      id: `cmd-${commandIndex.value}`,
      kind: "arc",
      center: resolved ? { ...resolved.center } : null,
      radius: resolved?.radius ?? null,
      startAngle: resolved?.startAngle ?? null,
      endAngle: resolved?.endAngle ?? null,
      counterclockwise: resolved?.counterclockwise ?? null,
      valid: resolved !== null,
      pathId: path.id,
      segmentIndex,
    });
    current = segment.to;
    commandIndex.value += 1;
  });

  if (path.closed) {
    commands.push({
      id: `cmd-${commandIndex.value}`,
      kind: "closePath",
      pathId: path.id,
    });
    commandIndex.value += 1;
  }
};

export const buildSceneCommands = (scene: PlaygroundScene): SceneCommand[] => {
  const commands: SceneCommand[] = [];
  const index = { value: 0 };
  const emittedShapes = new Set<string>();

  scene.paths.forEach((path) => {
    if (path.shapeId) {
      const shape = scene.shapes.find((entry) => entry.id === path.shapeId);
      if (!shape || emittedShapes.has(shape.id)) {
        return;
      }
      emittedShapes.add(shape.id);
      commands.push({
        id: `cmd-${index.value}`,
        kind: "beginPath",
        targetId: shape.id,
        targetType: "shape",
      });
      index.value += 1;
      const shapePaths = scene.paths.filter((candidate) => shape.pathIds.includes(candidate.id));
      shapePaths.forEach((shapePath) => {
        pushPathCommands(commands, shapePath, index, { includeBeginPath: false, targetId: shape.id, targetType: "shape" });
      });
      applyPaintCommands(commands, shape.id, shape.style, shape.paint, index);
      return;
    }

    pushPathCommands(commands, path, index, { includeBeginPath: true, targetId: path.id, targetType: "path" });
    applyPaintCommands(commands, path.id, path.style, path.paint, index);
  });

  return commands;
};

export const syncSceneCommands = (scene: PlaygroundScene): PlaygroundScene => {
  scene.commands = buildSceneCommands(scene);
  return scene;
};

export const sceneToDocument = (scene: PlaygroundScene): GeometryDocument => {
  const commands = buildSceneCommands(scene);
  const context = new Canvas2DGeometryIRContext();
  let currentPoint: Point | null = null;

  for (const command of commands) {
    switch (command.kind) {
      case "beginPath":
        context.beginPath();
        currentPoint = null;
        break;
      case "moveTo":
        context.moveTo(command.x, command.y);
        currentPoint = { x: command.x, y: command.y };
        break;
      case "lineTo":
        context.lineTo(command.x, command.y);
        currentPoint = { x: command.x, y: command.y };
        break;
      case "bezierCurveTo":
        context.bezierCurveTo(
          command.cp1.x,
          command.cp1.y,
          command.cp2.x,
          command.cp2.y,
          command.to.x,
          command.to.y,
        );
        currentPoint = { x: command.to.x, y: command.to.y };
        break;
      case "curveThroughPoints": {
        const path = scene.paths.find((entry) => entry.id === command.pathId);
        const segment = path?.segments[command.segmentIndex];
        if (segment?.kind === "curveThroughPoints" && currentPoint !== null) {
          appendCurveThroughPointsToContext(context, currentPoint, command.points);
          currentPoint = command.points[command.points.length - 1] ?? currentPoint;
        }
        break;
      }
      case "arc":
        if (!command.valid || command.center === null || command.radius === null) {
          const path = scene.paths.find((entry) => entry.id === command.pathId);
          const segment = path?.segments[command.segmentIndex];
          if (segment?.kind === "arc") {
            context.lineTo(segment.to.x, segment.to.y);
            currentPoint = { x: segment.to.x, y: segment.to.y };
          }
          break;
        }
        context.arc(
          command.center.x,
          command.center.y,
          command.radius,
          command.startAngle ?? 0,
          command.endAngle ?? 0,
          command.counterclockwise ?? false,
        );
        currentPoint = {
          x: command.center.x + Math.cos(command.endAngle ?? 0) * (command.radius ?? 0),
          y: command.center.y + Math.sin(command.endAngle ?? 0) * (command.radius ?? 0),
        };
        break;
      case "closePath":
        context.closePath();
        currentPoint = null;
        break;
      case "fill":
        context.fillStyle = command.style.fillStyle;
        context.strokeStyle = command.style.strokeStyle;
        context.lineWidth = command.style.lineWidth;
        context.fill();
        break;
      case "stroke":
        context.fillStyle = command.style.fillStyle;
        context.strokeStyle = command.style.strokeStyle;
        context.lineWidth = command.style.lineWidth;
        context.stroke();
        break;
    }
  }

  return context.getDocument();
};
