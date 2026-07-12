import { defineElectrobunE2EConfig } from "electrobun-e2e/config";

export default defineElectrobunE2EConfig({
  appName: "svvy",
  buildInputPaths: [
    "assets",
    "bun.lock",
    "electrobun.config.ts",
    "generated",
    "package.json",
    "packages",
    "scripts",
    "src",
    "tsconfig.json",
    "vite.config.ts",
  ],
  buildCommand: ["bun", "run", "build:dev"],
});
