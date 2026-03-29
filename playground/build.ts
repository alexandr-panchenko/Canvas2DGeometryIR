import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const playgroundRoot = resolve(process.cwd(), "playground");
const siteDir = resolve(playgroundRoot, "site");
const bundlePath = "assets/main.js";
const stylesheetPath = "styles.css";

export const createPlaygroundIndexHtml = (): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Canvas2DGeometryIR Playground</title>
    <link rel="stylesheet" href="./${stylesheetPath}" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./${bundlePath}"></script>
  </body>
</html>
`;

export const buildPlaygroundSite = async (): Promise<void> => {
  await rm(siteDir, { recursive: true, force: true });
  await mkdir(resolve(siteDir, "assets"), { recursive: true });

  const result = await Bun.build({
    entrypoints: ["./playground/main.ts"],
    outdir: siteDir,
    naming: bundlePath,
    target: "browser",
    minify: false,
    sourcemap: "external",
  });

  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join("\n");
    throw new Error(`Playground build failed\n${messages}`);
  }

  await cp(resolve(playgroundRoot, "styles.css"), resolve(siteDir, stylesheetPath));
  await writeFile(resolve(siteDir, "index.html"), createPlaygroundIndexHtml(), "utf8");
  await writeFile(resolve(siteDir, ".nojekyll"), "", "utf8");
};

if (import.meta.main) {
  await buildPlaygroundSite();
  console.log(`Built playground site at ${siteDir}`);
}
