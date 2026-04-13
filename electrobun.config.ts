import type { ElectrobunConfig } from "electrobun";

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
      ],
    },
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
    },
    watchIgnore: ["dist/**"],
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
