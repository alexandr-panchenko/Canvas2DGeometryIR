import { cloneScene } from "./types";
import type { PlaygroundScene } from "./types";

export const builtInScenes: readonly PlaygroundScene[] = [
  {
    id: "line-basic",
    name: "Simple line path",
    paths: [
      {
        id: "line-a",
        paint: "stroke",
        style: { fillStyle: "#000000", strokeStyle: "#2563eb", lineWidth: 4 },
        start: { x: 80, y: 120 },
        segments: [
          { kind: "line", to: { x: 260, y: 80 } },
          { kind: "line", to: { x: 420, y: 180 } },
        ],
        closed: false,
      },
    ],
  },
  {
    id: "bezier-basic",
    name: "Simple Bézier path",
    paths: [
      {
        id: "bezier-a",
        paint: "stroke",
        style: { fillStyle: "#000000", strokeStyle: "#db2777", lineWidth: 3 },
        start: { x: 100, y: 220 },
        segments: [
          {
            kind: "bezier",
            cp1: { x: 180, y: 40 },
            cp2: { x: 320, y: 360 },
            to: { x: 460, y: 190 },
          },
        ],
        closed: false,
      },
    ],
  },
  {
    id: "overlap-mixed",
    name: "Overlapping mixed shapes",
    paths: [
      {
        id: "poly-fill",
        paint: "fill",
        style: { fillStyle: "rgba(14,165,233,0.35)", strokeStyle: "#0ea5e9", lineWidth: 2 },
        start: { x: 120, y: 90 },
        segments: [
          { kind: "line", to: { x: 360, y: 80 } },
          { kind: "line", to: { x: 390, y: 260 } },
          { kind: "line", to: { x: 150, y: 280 } },
        ],
        closed: true,
      },
      {
        id: "arc-stroke",
        paint: "stroke",
        style: { fillStyle: "#000000", strokeStyle: "#f97316", lineWidth: 5 },
        start: { x: 240, y: 220 },
        segments: [
          {
            kind: "arc",
            center: { x: 280, y: 200 },
            to: {
              x: 280 + Math.cos(Math.PI * 1.35) * 90,
              y: 200 + Math.sin(Math.PI * 1.35) * 90,
            },
            radius: 90,
            startAngle: Math.PI * 0.1,
            endAngle: Math.PI * 1.35,
            counterclockwise: false,
          },
        ],
        closed: false,
      },
    ],
  },
  {
    id: "transformed-like",
    name: "Transform-like scene",
    paths: [
      {
        id: "stroke-zig",
        paint: "stroke",
        style: { fillStyle: "#000000", strokeStyle: "#16a34a", lineWidth: 4 },
        start: { x: 90, y: 320 },
        segments: [
          { kind: "line", to: { x: 180, y: 250 } },
          { kind: "line", to: { x: 300, y: 350 } },
          { kind: "line", to: { x: 410, y: 220 } },
        ],
        closed: false,
      },
      {
        id: "bezier-fill",
        paint: "fill",
        style: { fillStyle: "rgba(168,85,247,0.35)", strokeStyle: "#a855f7", lineWidth: 2 },
        start: { x: 280, y: 110 },
        segments: [
          {
            kind: "bezier",
            cp1: { x: 370, y: 40 },
            cp2: { x: 470, y: 180 },
            to: { x: 380, y: 250 },
          },
          { kind: "line", to: { x: 260, y: 220 } },
        ],
        closed: true,
      },
    ],
  },
];

export const getBuiltInScene = (id: string): PlaygroundScene | null => {
  const match = builtInScenes.find((scene) => scene.id === id);
  return match ? cloneScene(match) : null;
};
