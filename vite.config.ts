import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    {
      name: "svvy-packaged-markdown-text",
      enforce: "pre",
      load(id) {
        if (!id.includes("/packages/extensions/src/builtin/") || !id.endsWith(".md")) {
          return null;
        }

        return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
      },
    },
    tailwindcss(),
    svelte({
      configFile: resolve("./svelte.config.js"),
    }),
  ],
  root: "src/mainview",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
