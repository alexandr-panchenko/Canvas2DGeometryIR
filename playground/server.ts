import { join } from "node:path";
import { buildPlaygroundSite } from "./build";

await buildPlaygroundSite();

const server = Bun.serve({
  port: 4070,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname === "/" ? "/playground/site/index.html" : `/playground/site${url.pathname}`;
    const filePath = join(process.cwd(), path.replace(/^\//, ""));
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(file);
  },
});

console.log(`Playground available at ${server.url}`);
