import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/index.ts",
  format: ["cjs", "esm"],
  dts: true,
  outDir: "dist",
  platform: "node",
  target: "esnext",
  fixedExtension: false,
  deps: { skipNodeModulesBundle: true },
});
