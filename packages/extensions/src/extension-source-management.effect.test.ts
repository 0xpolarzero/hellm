import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Crypto from "effect/Crypto";
import * as Path from "effect/Path";
import { ExtensionError } from "@svvy/core";
import type {
  AbsolutePath,
  CreateExtensionSourceInput,
  ExtensionId,
  WorkspaceId,
} from "@svvy/core";
import {
  addExtensionInstruction,
  createExtensionSource,
  finalizeExtensionSourceMutation,
  renameExtensionInstruction,
  reorderExtensionInstructions,
  resetExtensionInstructions,
  revertExtensionSourceMutation,
} from "./extension-source-lifecycle";
import {
  configureExtensionTypescriptApi,
  materializeBuiltinExtensionSource,
  promoteStagedExtensionSource,
} from "./extension-source-management";
import { layerExtensionSourceRootsPort } from "./extension-source-roots-port";
import { layerPackagedExtensionTemplatesPort } from "./packaged-extension-templates-port";

describe("extension source promotion", () => {
  it.effect("materializes the packaged builtin tree byte-for-byte", () => {
    const packagedManifest = manifest("base-common", false, {
      interface: "instructions",
      instructionFiles: [{ file: "010-base-common.mdx", bypassed: false }],
    });
    const harness = configureHarness({
      "/packaged/base-common/manifest.json": packagedManifest,
      "/packaged/base-common/instructions/minimal.mdx": "minimal\n",
      "/packaged/base-common/instructions/full/010-base-common.mdx": "canonical\n",
    });
    return Effect.gen(function* () {
      const result = yield* harness.runLifecycle(materializeBuiltinExtensionSource("base-common"));
      assert.isTrue(result.created);
      assert.strictEqual(
        harness.file("/extensions/sources/builtin/base-common/manifest.json"),
        packagedManifest,
      );
      assert.strictEqual(
        harness.file(
          "/extensions/sources/builtin/base-common/instructions/full/010-base-common.mdx",
        ),
        "canonical\n",
      );
    });
  });

  it.effect("rolls the live root back when staged promotion fails", () =>
    Effect.gen(function* () {
      const roots = new Set(["/live", "/staging"]);
      const fs = {
        rename: (from: string, to: string) =>
          Effect.gen(function* () {
            if (from === "/staging")
              return yield* Effect.fail(new Error("injected promotion failure"));
            if (!roots.delete(from)) return yield* Effect.fail(new Error(`missing ${from}`));
            roots.add(to);
          }),
        remove: () => Effect.void,
      } as unknown as FileSystem.FileSystem;
      const exit = yield* Effect.exit(
        promoteStagedExtensionSource({
          fs,
          live: "/live",
          staging: "/staging",
          backup: "/backup",
          onFailure: (message, cause) =>
            new ExtensionError({ operation: "test", reason: "execution-failed", message, cause }),
        }),
      );
      assert.isTrue(exit._tag === "Failure");
      assert.isTrue(roots.has("/live"));
      assert.isFalse(roots.has("/backup"));
    }),
  );

  it.effect("reports success when backup cleanup fails after promotion committed", () =>
    Effect.gen(function* () {
      const roots = new Set(["/live", "/staging"]);
      const fs = {
        rename: (from: string, to: string) =>
          Effect.sync(() => {
            if (!roots.delete(from)) throw new Error(`missing ${from}`);
            roots.add(to);
          }),
        remove: () => Effect.fail(new Error("injected cleanup failure")),
      } as unknown as FileSystem.FileSystem;
      yield* promoteStagedExtensionSource({
        fs,
        live: "/live",
        staging: "/staging",
        backup: "/backup",
        onFailure: (message, cause) =>
          new ExtensionError({ operation: "test", reason: "execution-failed", message, cause }),
      });
      assert.isTrue(roots.has("/live"));
      assert.isTrue(roots.has("/backup"));
      assert.isFalse(roots.has("/staging"));
    }),
  );
});

describe("configure extension TypeScript API", () => {
  it.effect("preserves extra manifest fields and reports changed writes", () => {
    const harness = configureHarness({
      "/extensions/sources/user/demo/manifest.json": manifest("demo", true, {
        custom: { keep: true },
      }),
      "/extensions/sources/user/demo/instructions/minimal.mdx": "demo",
    });
    return Effect.gen(function* () {
      const result = yield* harness.run("demo", false);
      assert.deepStrictEqual(result, {
        extensionId: "demo",
        enabled: false,
        changed: true,
        reconcileRequired: true,
      });
      const saved = JSON.parse(harness.file("/extensions/sources/user/demo/manifest.json"));
      assert.deepStrictEqual(saved.custom, { keep: true });
      assert.strictEqual(saved.typescriptApiEnabled, false);
      assert.strictEqual(saved.workflowTaskAgentReferenceExportEnabled, false);
    });
  });

  it.effect("does not rewrite an already matching manifest", () => {
    const source = manifest("demo", false, { custom: "stable" });
    const harness = configureHarness({ "/extensions/sources/user/demo/manifest.json": source });
    return Effect.gen(function* () {
      const result = yield* harness.run("demo", false);
      assert.isFalse(result.changed);
      assert.isFalse(result.reconcileRequired);
      assert.strictEqual(harness.file("/extensions/sources/user/demo/manifest.json"), source);
      assert.strictEqual(harness.renameCount(), 0);
    });
  });

  it.effect("rejects instructions manifests before considering a false no-op", () => {
    const harness = configureHarness({
      "/extensions/sources/user/demo/manifest.json": manifest("demo", false, {
        interface: "instructions",
      }),
    });
    return Effect.gen(function* () {
      const exit = yield* Effect.exit(harness.run("demo", false));
      assert.strictEqual(exit._tag, "Failure");
      assert.strictEqual(harness.renameCount(), 0);
    });
  });

  it.effect("scaffolds a pristine builtin from its packaged editable template", () => {
    const harness = configureHarness({
      "/packaged/workflows/manifest.json": manifest("workflows", false),
      "/packaged/workflows/instructions/minimal.mdx": "workflows",
    });
    return Effect.gen(function* () {
      const result = yield* harness.run("workflows", true);
      assert.isTrue(result.changed);
      assert.strictEqual(
        JSON.parse(harness.file("/extensions/sources/builtin/workflows/manifest.json"))
          .typescriptApiEnabled,
        true,
      );
      assert.strictEqual(harness.file("/packaged/workflows/instructions/minimal.mdx"), "workflows");
    });
  });

  it.effect("rejects an app-owned svvyx namespace without an editable template", () => {
    const harness = configureHarness({});
    return Effect.gen(function* () {
      const exit = yield* Effect.exit(harness.run("extension-managing", true));
      assert.strictEqual(exit._tag, "Failure");
      assert.strictEqual(harness.renameCount(), 0);
    });
  });

  it.effect("keeps the live manifest unchanged when staged publication fails", () => {
    const source = manifest("demo", false);
    const harness = configureHarness(
      { "/extensions/sources/user/demo/manifest.json": source },
      { failStagingPromotion: true },
    );
    return Effect.gen(function* () {
      const exit = yield* Effect.exit(harness.run("demo", true));
      assert.strictEqual(exit._tag, "Failure");
      assert.strictEqual(harness.file("/extensions/sources/user/demo/manifest.json"), source);
    });
  });
});

describe("extension source lifecycle", () => {
  it.effect("resets only builtin instruction scope to packaged canonical bytes", () => {
    const defaultManifest = manifest("base-common", false, {
      interface: "instructions",
      instructionFiles: [{ file: "010-base-common.mdx", bypassed: false }],
    });
    const harness = configureHarness({
      "/packaged/base-common/manifest.json": defaultManifest,
      "/packaged/base-common/instructions/minimal.mdx": "packaged minimal\n",
      "/packaged/base-common/instructions/full/010-base-common.mdx": "packaged full\n",
      "/extensions/sources/builtin/base-common/manifest.json": manifest("base-common", false, {
        interface: "instructions",
        instructionFiles: [{ file: "010-custom.mdx", bypassed: false }],
        custom: "preserved",
      }),
      "/extensions/sources/builtin/base-common/instructions/minimal.mdx": "custom minimal\n",
      "/extensions/sources/builtin/base-common/instructions/full/010-custom.mdx": "custom\n",
    });
    return Effect.gen(function* () {
      const result = yield* harness.runLifecycle(
        resetExtensionInstructions({ extensionId: "base-common" } as never),
      );
      assert.isTrue(result.changed);
      assert.strictEqual(
        harness.file(
          "/extensions/sources/builtin/base-common/instructions/full/010-base-common.mdx",
        ),
        "packaged full\n",
      );
      assert.strictEqual(
        JSON.parse(harness.file("/extensions/sources/builtin/base-common/manifest.json")).custom,
        "preserved",
      );
    });
  });

  it.effect("publishes a complete MDX instruction extension in one source-root rename", () => {
    const harness = configureHarness({});
    return Effect.gen(function* () {
      const result = yield* harness.runLifecycle(
        createExtensionSource({
          id: "notes",
          title: "Notes",
          description: "Notes guidance.",
          interfaceKind: "instructions",
          typescriptApiEnabled: false,
        } as CreateExtensionSourceInput),
      );
      assert.strictEqual(result.action, "created");
      assert.strictEqual(
        harness.file("/extensions/sources/user/notes/instructions/full/010-notes.mdx"),
        "# Notes\n",
      );
      assert.strictEqual(
        harness.file("/extensions/sources/user/notes/instructions/minimal.mdx"),
        "",
      );
      assert.deepStrictEqual(
        JSON.parse(harness.file("/extensions/sources/user/notes/manifest.json")).instructionFiles,
        [{ file: "010-notes.mdx", bypassed: false }],
      );
    });
  });

  it.effect("adds editable MDX through staged replacement and retains reversible history", () => {
    const harness = configureHarness({
      "/extensions/sources/user/notes/manifest.json": `${JSON.stringify({
        schemaVersion: 1,
        id: "notes",
        title: "Notes",
        description: "Notes guidance.",
        interface: "instructions",
        typescriptApiEnabled: false,
        instructionFiles: [],
      })}\n`,
      "/extensions/sources/user/notes/instructions/minimal.mdx": "",
    });
    return Effect.gen(function* () {
      const result = yield* harness.runLifecycle(
        addExtensionInstruction({ extensionId: "notes", name: "020-extra.mdx" } as never),
      );
      assert.strictEqual(result.action, "instruction-added");
      assert.strictEqual(
        harness.file("/extensions/sources/user/notes/instructions/full/020-extra.mdx"),
        "",
      );
      assert.match(
        harness.file(`/extensions/.svvy/lifecycle-journal/${result.mutationId}.json`),
        /"status": "committed"/,
      );
    });
  });

  it.effect("renames and reverts an instruction through retained digest-backed history", () => {
    const harness = configureHarness({
      "/extensions/sources/user/notes/manifest.json": manifest("notes", false, {
        interface: "instructions",
        instructionFiles: [{ file: "010-notes.mdx", bypassed: false }],
      }),
      "/extensions/sources/user/notes/instructions/full/010-notes.mdx": "notes\n",
      "/extensions/sources/user/notes/instructions/minimal.mdx": "",
    });
    return Effect.gen(function* () {
      const renamed = yield* harness.runLifecycle(
        renameExtensionInstruction({
          extensionId: "notes",
          from: "010-notes.mdx",
          to: "010-guide.mdx",
        } as never),
      );
      yield* harness.runLifecycle(finalizeExtensionSourceMutation(renamed.mutationId));
      assert.strictEqual(
        harness.file("/extensions/sources/user/notes/instructions/full/010-guide.mdx"),
        "notes\n",
      );
      const reverted = yield* harness.runLifecycle(
        revertExtensionSourceMutation({ mutationId: renamed.mutationId }),
      );
      assert.strictEqual(reverted.revertedMutationId, renamed.mutationId);
      assert.strictEqual(
        harness.file("/extensions/sources/user/notes/instructions/full/010-notes.mdx"),
        "notes\n",
      );
    });
  });

  it.effect("reorders editable instructions with deterministic prefixes atomically", () => {
    const harness = configureHarness({
      "/extensions/sources/user/notes/manifest.json": manifest("notes", false, {
        interface: "instructions",
        instructionFiles: [
          { file: "010-one.mdx", bypassed: false },
          { file: "020-two.mdx", bypassed: true },
        ],
      }),
      "/extensions/sources/user/notes/instructions/full/010-one.mdx": "one\n",
      "/extensions/sources/user/notes/instructions/full/020-two.mdx": "two\n",
      "/extensions/sources/user/notes/instructions/minimal.mdx": "",
    });
    return Effect.gen(function* () {
      const result = yield* harness.runLifecycle(
        reorderExtensionInstructions({
          extensionId: "notes",
          order: ["020-two.mdx", "010-one.mdx"],
        } as never),
      );
      assert.isTrue(result.changed);
      assert.deepStrictEqual(result.order.map(String), ["010-two.mdx", "020-one.mdx"]);
      assert.strictEqual(
        harness.file("/extensions/sources/user/notes/instructions/full/010-two.mdx"),
        "two\n",
      );
    });
  });
});

function manifest(id: string, enabled: boolean, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ schemaVersion: 1, id, title: id, description: id, interface: "svvyx", typescriptApiEnabled: enabled, instructionFiles: [], ...extra }, null, 2)}\n`;
}

function configureHarness(
  initial: Record<string, string>,
  options: { failStagingPromotion?: boolean } = {},
) {
  const files = new Map(Object.entries(initial));
  const directories = new Set<string>([
    "/",
    "/extensions",
    "/extensions/sources",
    "/extensions/sources/user",
    "/extensions/sources/builtin",
    "/packaged",
  ]);
  for (const file of files.keys()) addParents(directories, dirname(file));
  let renames = 0;
  const fs = {
    exists: (target: string) => Effect.succeed(files.has(target) || directories.has(target)),
    readLink: (target: string) => Effect.fail(new Error(`not a symbolic link: ${target}`)),
    stat: (target: string) =>
      files.has(target)
        ? Effect.succeed({ type: "File" })
        : directories.has(target)
          ? Effect.succeed({ type: "Directory" })
          : Effect.fail(new Error(`missing ${target}`)),
    readFileString: (target: string) =>
      files.has(target)
        ? Effect.succeed(files.get(target)!)
        : Effect.fail(new Error(`missing ${target}`)),
    readFile: (target: string) =>
      files.has(target)
        ? Effect.succeed(new TextEncoder().encode(files.get(target)!))
        : Effect.fail(new Error(`missing ${target}`)),
    writeFile: (target: string, bytes: Uint8Array) =>
      Effect.sync(() => {
        addParents(directories, dirname(target));
        files.set(target, new TextDecoder().decode(bytes));
      }),
    writeFileString: (target: string, text: string) =>
      Effect.sync(() => {
        addParents(directories, dirname(target));
        files.set(target, text);
      }),
    readDirectory: (target: string) => Effect.succeed(children(target, files, directories)),
    makeDirectory: (target: string) => Effect.sync(() => addParents(directories, target)),
    remove: (target: string) => Effect.sync(() => removeTree(target, files, directories)),
    rename: (from: string, to: string) =>
      Effect.gen(function* () {
        renames += 1;
        if (
          options.failStagingPromotion &&
          from.includes(".staging-") &&
          to === "/extensions/sources/user/demo"
        ) {
          return yield* Effect.fail(new Error("injected staged promotion failure"));
        }
        moveTree(from, to, files, directories);
      }),
  } as unknown as FileSystem.FileSystem;
  const path = {
    join,
    resolve: join,
    dirname,
    basename: (value: string) => value.split("/").at(-1) ?? "",
    sep: "/",
  } as unknown as Path.Path;
  const crypto = Crypto.make({
    digest: (_algorithm, data) => Effect.succeed(data),
    randomBytes: (size) => new Uint8Array(size).fill(1),
  });
  const rootsLayer = layerExtensionSourceRootsPort({
    extensionsRoot: "/extensions" as AbsolutePath,
    workflowsSourceRoot: "/workflows" as AbsolutePath,
  });
  const templatesLayer = layerPackagedExtensionTemplatesPort({
    builtinExtensionsRoot: "/packaged" as AbsolutePath,
  });
  return {
    run: (extensionId: string, enabled: boolean) =>
      configureExtensionTypescriptApi({
        workspaceId: "workspace" as WorkspaceId,
        extensionId: extensionId as ExtensionId,
        enabled,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provide(rootsLayer),
        Effect.provide(templatesLayer),
      ),
    file: (target: string) => files.get(target) ?? "",
    runLifecycle: <A, E>(
      effect: Effect.Effect<
        A,
        E,
        | FileSystem.FileSystem
        | Path.Path
        | Crypto.Crypto
        | import("./extension-source-roots-port").ExtensionSourceRootsPort
        | import("./packaged-extension-templates-port").PackagedExtensionTemplatesPort
      >,
    ) =>
      effect.pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provide(rootsLayer),
        Effect.provide(templatesLayer),
      ),
    renameCount: () => renames,
  };
}

function join(...parts: readonly string[]): string {
  return `/${parts
    .flatMap((part) => part.split("/"))
    .filter(Boolean)
    .join("/")}`;
}
function dirname(value: string): string {
  const parts = value.split("/").filter(Boolean);
  parts.pop();
  const parent = `/${parts.join("/")}`;
  return parent === "" ? "/" : parent;
}
function addParents(dirs: Set<string>, value: string): void {
  let current = "";
  for (const part of value.split("/").filter(Boolean)) {
    current += `/${part}`;
    dirs.add(current);
  }
  dirs.add("/");
}
function children(
  root: string,
  files: ReadonlyMap<string, string>,
  dirs: ReadonlySet<string>,
): string[] {
  const prefix = `${root}/`;
  return [
    ...new Set(
      [...files.keys(), ...dirs]
        .filter((entry) => entry.startsWith(prefix))
        .map((entry) => entry.slice(prefix.length).split("/")[0])
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ];
}
function removeTree(root: string, files: Map<string, string>, dirs: Set<string>): void {
  for (const key of files.keys()) if (key === root || key.startsWith(`${root}/`)) files.delete(key);
  for (const key of dirs) if (key === root || key.startsWith(`${root}/`)) dirs.delete(key);
}
function moveTree(from: string, to: string, files: Map<string, string>, dirs: Set<string>): void {
  const movedFiles = [...files].filter(([key]) => key === from || key.startsWith(`${from}/`));
  const movedDirs = [...dirs].filter((key) => key === from || key.startsWith(`${from}/`));
  if (!movedFiles.length && !movedDirs.length) throw new Error(`missing ${from}`);
  removeTree(to, files, dirs);
  removeTree(from, files, dirs);
  for (const key of movedDirs) dirs.add(`${to}${key.slice(from.length)}`);
  for (const [key, value] of movedFiles) files.set(`${to}${key.slice(from.length)}`, value);
  addParents(dirs, dirname(to));
}
