import type { ElectrobunConfig } from "electrobun";
import { APP_BUN_RUNTIME } from "./scripts/bun-runtime-contract";

const createDmg = process.env.SVVY_CREATE_DMG === "1" && process.env.SVVY_SKIP_DMG !== "1";

export default {
  app: {
    name: "svvy",
    identifier: "dev.polarzero.svvy",
    version: "0.0.1",
  },
  scripts: {
    postBuild: "scripts/postbuild.ts",
  },
  build: {
    // Stable Bun 1.3.14 corrupts JSC handles when Electrobun's threadsafe FFI
    // callbacks arrive from native threads. The upstream fix is only available
    // on Bun's rolling canary until the next stable release includes it.
    bunVersion: APP_BUN_RUNTIME.releaseTag,
    bun: {
      external: [
        "@rivet-dev/*",
        "secure-exec",
        "@secure-exec/*",
        "node-stdlib-browser",
        "esbuild",
        "@esbuild/*",
        "web-streams-polyfill",
        "cbor-x",
        "cjs-module-lexer",
        "es-module-lexer",
        "pkg-dir",
        "@mariozechner/*",
        "@agentclientprotocol/*",
        "better-sqlite3",
        "pyodide",
        "react",
        "react-dom",
        "zod",
      ],
    },
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/popout.html": "views/mainview/popout.html",
      "dist/assets": "views/mainview/assets",
    },
    watchIgnore: ["dist/**"],
    mac: {
      bundleCEF: false,
      createDmg,
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: "cef",
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
