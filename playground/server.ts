import { join } from "node:path";

await Bun.build({
  entrypoints: ["./playground/main.ts"],
  outdir: "./playground/dist",
  target: "browser",
  sourcemap: "external",
});

const server = Bun.serve({
  port: 4070,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname === "/" ? "/playground/index.html" : url.pathname;
    const filePath = join(process.cwd(), path.replace(/^\//, ""));
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(file);
  },
});

console.log(`Playground available at ${server.url}`);
