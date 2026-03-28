await Bun.build({
  entrypoints: ["./playground/main.ts"],
  outdir: "./playground/dist",
  target: "browser",
  minify: false,
  sourcemap: "external",
});

console.log("Built playground bundle at playground/dist/main.js");
