import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2020",
  external: ["react", "react-dom", "@microsurveysai/web-core"],
  // The whole package is client-side (hooks, DOM, portals). Mark the built bundle "use client"
  // so it drops cleanly into React Server Component apps (Next App Router).
  banner: { js: '"use client";' },
});
