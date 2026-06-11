import type { ElectrobunConfig } from "electrobun";

const createDmg = process.env.SVVY_SKIP_DMG !== "1";

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
    bunVersion: "1.3.10",
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
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
