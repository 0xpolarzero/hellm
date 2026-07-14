import { defineElectrobunE2EConfig } from "electrobun-e2e/config";
import { APP_BUN_RUNTIME } from "./scripts/bun-runtime-contract";

export default defineElectrobunE2EConfig({
  appName: "svvy",
  linuxWorkspaceDir: "$HOME/code/svvy",
  machineArch: "arm64",
  machineName: "svvy-e2e",
  bunVersion: APP_BUN_RUNTIME.releaseTag,
  extraAptPackages: ["file", "gdb", "libnspr4", "libnss3", "scrot", "util-linux", "xdotool"],
  buildInputPaths: [
    "assets",
    "bun.lock",
    "electrobun.config.ts",
    "generated",
    "package.json",
    "packages",
    "patches",
    "scripts",
    "src",
    "tsconfig.json",
    "vite.config.ts",
  ],
  buildCommand: ["bun", "scripts/build-e2e-app.ts"],
  installCommand: ["bun", "scripts/e2e-build-prepare.ts"],
  testCommand: ["bash", "scripts/run-e2e-tests.sh"],
  runtimeEnv: {
    ELECTROBUN_E2E_LAUNCH_RETRIES: "0",
    SVVY_E2E_EVIDENCE_DIR: "e2e-results",
    SVVY_E2E_RUN_ID: process.env.SVVY_E2E_RUN_ID ?? "untracked-run",
    SVVY_E2E_STARTUP_SOAK_LAUNCHES: process.env.SVVY_E2E_STARTUP_SOAK_LAUNCHES ?? "1",
  },
  syncExcludes: ["/e2e-results", ".svvy-e2e-build-inputs.sha256"],
});
