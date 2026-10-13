import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub Pages などサブパス配置でも動くよう相対パス
  base: "./",
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
  test: {
    globals: true,
    environment: "node",
  },
});
