import type { ElectrobunConfig } from "electrobun";

// Desktop shell config for Smithers Studio 2.
//
// The web app is built by Vite into `dist/` (see `pnpm run build`). Electrobun
// does NOT rebuild the React app — it wraps the already-built Vite output. The
// whole `dist/` directory is copied verbatim into the bundle as the `mainview`
// view, and the Bun main process (electrobun/main.ts) opens a window pointed at
// `views://mainview/index.html`.
//
// Vite emits root-absolute asset URLs (e.g. `/assets/index.js`). Under the
// `views://mainview` origin those resolve to `views://mainview/assets/index.js`,
// so no Vite `base` rewrite is required and the web build is left untouched.
export default {
  app: {
    name: "Smithers Studio",
    identifier: "ai.smithers.studio",
    version: "0.1.0",
    description: "Next Smithers Studio UI shell.",
  },
  build: {
    bun: {
      entrypoint: "electrobun/main.ts",
      sourcemap: "linked",
    },
    views: {},
    copy: {
      dist: "views/mainview",
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
} satisfies ElectrobunConfig;
