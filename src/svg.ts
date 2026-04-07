import type { DrawOp, GeometryDocument } from "./types";
import { GeometryEngine } from "./geometry";

const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const segmentToSvg = (segment: DrawOp["path"]["subpaths"][number]["segments"][number]): string => {
  if (segment.kind === "line") {
    return `L ${segment.to.x} ${segment.to.y}`;
  }
  if (segment.kind === "bezier") {
    return `C ${segment.cp1.x} ${segment.cp1.y} ${segment.cp2.x} ${segment.cp2.y} ${segment.to.x} ${segment.to.y}`;
  }

  const endX = segment.center.x + Math.cos(segment.endAngle) * segment.radius;
  const endY = segment.center.y + Math.sin(segment.endAngle) * segment.radius;
  const rawSpan = segment.counterclockwise
    ? segment.startAngle - segment.endAngle
    : segment.endAngle - segment.startAngle;
  const normalizedSpan = ((rawSpan % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const largeArcFlag = normalizedSpan > Math.PI ? 1 : 0;
  const sweepFlag = segment.counterclockwise ? 0 : 1;
  return `A ${segment.radius} ${segment.radius} 0 ${largeArcFlag} ${sweepFlag} ${endX} ${endY}`;
};

export const drawOpToSvgPathData = (drawOp: DrawOp): string => {
  const commands: string[] = [];
  for (const subpath of drawOp.path.subpaths) {
    commands.push(`M ${subpath.start.x} ${subpath.start.y}`);
    for (const segment of subpath.segments) {
      commands.push(segmentToSvg(segment));
    }
    if (subpath.closed) {
      commands.push("Z");
    }
  }
  return commands.join(" ");
};

export const drawOpToSvgElement = (drawOp: DrawOp): string => {
  const attributes = [
    `d="${escapeAttribute(drawOpToSvgPathData(drawOp))}"`,
    `fill="${escapeAttribute(drawOp.paint === "fill" ? drawOp.style.fillStyle : "none")}"`,
    `stroke="${escapeAttribute(drawOp.paint === "stroke" ? drawOp.style.strokeStyle : "none")}"`,
    `stroke-width="${drawOp.paint === "stroke" ? drawOp.style.lineWidth : 0}"`,
    `fill-rule="${drawOp.fillRule}"`,
    `stroke-linecap="${drawOp.style.lineCap}"`,
    `stroke-linejoin="${drawOp.style.lineJoin}"`,
    `stroke-miterlimit="${drawOp.style.miterLimit}"`,
  ];

  if (drawOp.style.lineDash.length > 0) {
    attributes.push(`stroke-dasharray="${drawOp.style.lineDash.join(" ")}"`);
  }
  if (drawOp.paint === "fill" && drawOp.style.fillOpacity !== 1) {
    attributes.push(`fill-opacity="${drawOp.style.fillOpacity}"`);
  }
  if (drawOp.paint === "stroke" && drawOp.style.strokeOpacity !== 1) {
    attributes.push(`stroke-opacity="${drawOp.style.strokeOpacity}"`);
  }
  return `<path ${attributes.join(" ")} />`;
};

export const documentToSvg = (
  document: GeometryDocument,
  options: { padding?: number; background?: string } = {},
): string => {
  const padding = options.padding ?? 0;
  const engine = new GeometryEngine(document);
  const bounds = engine.getPaintBounds();
  const minX = (bounds?.minX ?? 0) - padding;
  const minY = (bounds?.minY ?? 0) - padding;
  const width = bounds ? bounds.maxX - bounds.minX + padding * 2 : 0;
  const height = bounds ? bounds.maxY - bounds.minY + padding * 2 : 0;
  const children: string[] = [];
  if (options.background) {
    children.push(
      `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${escapeAttribute(options.background)}" />`
    );
  }
  children.push(...document.drawOps.map(drawOpToSvgElement));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">`,
    ...children,
    `</svg>`,
  ].join("");
};
