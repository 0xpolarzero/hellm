export const EXTENSION_BUILD_RUNTIME_HELPER_SOURCE = String.raw`
import { pathToFileURL } from "node:url";
const request = JSON.parse(process.argv.at(-1));
const fail = (message) => { process.stdout.write(JSON.stringify({ ok: false, message })); process.exit(0); };
try {
  const result = await Bun.build({
    entrypoints: [request.sourcePath],
    format: "esm",
    target: "bun",
    naming: "index.js",
    outdir: request.outputDirectory,
    plugins: [{
      name: "svvy-extension-incur",
      setup(build) {
        build.onResolve({ filter: /^incur$/ }, () => ({ path: request.incurPath }));
      },
    }],
  });
  if (!result.success || result.outputs.length !== 1) fail("Runtime bundle failed.");
  const loaded = await import(pathToFileURL(request.runtimeOutputPath).href + "?build=" + Date.now());
  const cli = loaded.default;
  if (!cli || typeof cli.serve !== "function") fail("Runtime module must default-export an Incur CLI.");
  let stdout = "";
  let exitCode = 0;
  await cli.serve(["--llms-full", "--format", "json"], {
    env: {},
    stdout(chunk) {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > request.maxManifestBytes) throw new Error("Command manifest exceeds its byte cap.");
    },
    exit(code) { exitCode = code; },
  });
  if (exitCode !== 0) fail("Command manifest extraction failed.");
  const manifest = JSON.parse(stdout);
  const incur = await import(request.incurPath);
  const commands = incur.Cli?.toCommands?.get(cli);
  const details = new Map();
  const visit = (items, prefix = []) => {
    const aliases = new Map();
    for (const [name, entry] of items ?? []) {
      if (entry?._alias === true && typeof entry.target === "string") {
        const target = [...prefix, entry.target].join(" ");
        aliases.set(target, [...(aliases.get(target) ?? []), [...prefix, name].join(" ")]);
      }
    }
    for (const [name, entry] of items ?? []) {
      if (!entry || entry._alias === true) continue;
      const path = [...prefix, name];
      if (entry._group === true && entry.commands instanceof Map) visit(entry.commands, path);
      else {
        const id = path.join(" ");
        details.set(id, {
          aliases: (aliases.get(id) ?? []).sort(),
          streaming: typeof entry.run === "function" && entry.run.constructor.name === "AsyncGeneratorFunction",
        });
      }
    }
  };
  visit(commands);
  manifest.commands = manifest.commands.map((command) => {
    const detail = details.get(command.name);
    return { ...command, ...(detail?.aliases?.length ? { aliases: detail.aliases } : {}), ...(detail?.streaming ? { streaming: true } : {}) };
  });
  process.stdout.write(JSON.stringify({ ok: true, commandManifest: manifest }));
} catch (error) {
  fail(error instanceof Error ? error.message : "Runtime build helper failed.");
}
`;
