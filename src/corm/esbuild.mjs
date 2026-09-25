import { build } from "esbuild";

await build({
  absWorkingDir: import.meta.dirname,
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "neutral",
  format: "iife",
  target: "esnext",
  outfile: "dist/index.js",
  minify: false,
  sourcemap: false,
  logLevel: "info",
});
