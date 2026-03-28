import { Canvas2DGeometryIRContext, GeometryEngine, serializeDocument } from "../src";

const ctx = new Canvas2DGeometryIRContext();
ctx.beginPath();
ctx.moveTo(10, 10);
ctx.lineTo(90, 10);
ctx.lineTo(90, 80);
ctx.closePath();
ctx.fillStyle = "#2b6cb0";
ctx.fill();

ctx.beginPath();
ctx.moveTo(0, 0);
ctx.bezierCurveTo(20, 60, 80, -20, 100, 40);
ctx.strokeStyle = "#111111";
ctx.lineWidth = 2;
ctx.stroke();

const doc = ctx.getDocument();
const engine = new GeometryEngine(doc);
console.log("bounds", engine.getBounds());
console.log("anchors", engine.getAnchorCandidates().length);
console.log("json", serializeDocument(doc));
