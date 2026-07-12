import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  DEFAULT_EXTERNAL_INSTRUCTIONS,
  type AbsolutePath,
  type ExternalInstructionScanInput,
  type ExternalInstructionsSettings,
  type WorkspaceId,
} from "@svvy/core";
import {
  resolveExternalInstructionSource,
  saveExternalInstructionSource,
  scanExternalInstructions,
} from "./external-instructions";

interface Harness {
  readonly files: Map<string, string>;
  readonly unreadable: Set<string>;
  readonly realPaths: Map<string, string>;
  readonly directories: Set<string>;
  readonly provide: <A, E>(
    effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Crypto.Crypto>,
  ) => Effect.Effect<A, E>;
}

describe("external instruction discovery", () => {
  it.effect("applies AGENTS.md and CLAUDE.md defaults with metadata/content separation", () => {
    const harness = makeHarness({
      files: {
        "/repo/AGENTS.md": "repo agents",
        "/repo/CLAUDE.md": "repo claude",
        "/repo/pkg/CLAUDE.md": "package claude",
      },
    });
    return Effect.gen(function* () {
      const result = yield* harness.provide(scanExternalInstructions(scanInput()));
      assert.deepStrictEqual(
        result.sources.map((source) => [source.canonicalPath, source.enabled]),
        [
          ["/repo/AGENTS.md", true],
          ["/repo/CLAUDE.md", false],
          ["/repo/pkg/CLAUDE.md", true],
        ],
      );
      assert.deepStrictEqual(
        result.sources.map((source) => source.eligibleActors),
        [
          ["orchestrator", "handler", "workflow-task"],
          ["orchestrator", "handler", "workflow-task"],
          ["orchestrator", "handler", "workflow-task"],
        ],
      );
      assert.strictEqual("content" in result.sources[0]!, false);
      assert.deepStrictEqual(
        result.contents.map((source) => source.content),
        ["repo agents", "repo claude", "package claude"],
      );
    });
  });

  it.effect("applies persisted workspace controls by canonical path", () => {
    const harness = makeHarness({
      files: {
        "/repo/AGENTS.md": "repo agents",
        "/repo/CLAUDE.md": "repo claude",
      },
    });
    const settings: ExternalInstructionsSettings = {
      ...DEFAULT_EXTERNAL_INSTRUCTIONS,
      workspaceControls: {
        workspace_external_instructions: {
          "/repo/AGENTS.md": { enabled: false, actors: ["orchestrator"] },
          "/repo/CLAUDE.md": { enabled: true, actors: ["handler"] },
        },
      },
    };
    return Effect.gen(function* () {
      const result = yield* harness.provide(scanExternalInstructions(scanInput({ settings })));
      assert.deepStrictEqual(
        result.sources.map((source) => [source.fileName, source.enabled, source.eligibleActors]),
        [
          ["AGENTS.md", false, ["orchestrator"]],
          ["CLAUDE.md", true, ["handler"]],
        ],
      );
    });
  });

  it.effect("expands enabled builtin home roots from trusted host input", () => {
    const harness = makeHarness({
      files: { "/home/test/.config/pi/AGENTS.md": "global" },
    });
    const settings: ExternalInstructionsSettings = {
      ...DEFAULT_EXTERNAL_INSTRUCTIONS,
      globalRoots: DEFAULT_EXTERNAL_INSTRUCTIONS.globalRoots.map((root) => ({
        ...root,
        enabled: root.id === "pi",
      })),
    };
    return Effect.gen(function* () {
      const result = yield* harness.provide(scanExternalInstructions(scanInput({ settings })));
      assert.strictEqual(result.sources[0]?.canonicalPath, "/home/test/.config/pi/AGENTS.md");
      assert.strictEqual(result.sources[0]?.sourceGroup, "builtin_global_root");
    });
  });

  it.effect("keeps workspace discovery ordered from filesystem root to cwd", () => {
    const harness = makeHarness({
      files: {
        "/AGENTS.md": "filesystem rules",
        "/repo/AGENTS.md": "repo rules",
        "/repo/pkg/AGENTS.md": "package rules",
      },
    });
    return Effect.gen(function* () {
      const result = yield* harness.provide(scanExternalInstructions(scanInput()));
      assert.deepStrictEqual(
        result.sources.map((source) => source.canonicalPath),
        ["/AGENTS.md", "/repo/AGENTS.md", "/repo/pkg/AGENTS.md"],
      );
    });
  });

  it.effect("deduplicates canonical roots and keeps source ids stable across root order", () => {
    const harness = makeHarness({
      files: {
        "/standards/AGENTS.md": "shared",
        "/other/AGENTS.md": "other",
      },
      realPaths: { "/alias": "/standards" },
    });
    const first = settingsWithRoots([
      customRoot("standards", "/standards"),
      customRoot("alias", "/alias"),
      customRoot("other", "/other"),
    ]);
    const second = settingsWithRoots([
      customRoot("other", "/other"),
      customRoot("alias", "/alias"),
      customRoot("standards", "/standards"),
    ]);
    return Effect.gen(function* () {
      const a = yield* harness.provide(scanExternalInstructions(scanInput({ settings: first })));
      const b = yield* harness.provide(scanExternalInstructions(scanInput({ settings: second })));
      assert.strictEqual(a.sources.length, 2);
      assert.strictEqual(b.sources.length, 2);
      assert.deepStrictEqual(
        a.sources.map((source) => source.id).toSorted(),
        b.sources.map((source) => source.id).toSorted(),
      );
      assert.ok(a.sources.every((source) => !source.id.includes(source.canonicalPath)));
    });
  });

  it.effect("reports unreadable sources and treats deletion as unavailable on resolution", () => {
    const harness = makeHarness({ files: { "/repo/AGENTS.md": "rules" } });
    harness.unreadable.add("/repo/AGENTS.md");
    return Effect.gen(function* () {
      const result = yield* harness.provide(scanExternalInstructions(scanInput()));
      assert.strictEqual(result.sources[0]?.readStatus.status, "unreadable");
      assert.strictEqual(result.contents.length, 0);
      assert.strictEqual(result.diagnostics[0]?.code, "external-instruction-unreadable");

      harness.unreadable.clear();
      const readable = yield* harness.provide(scanExternalInstructions(scanInput()));
      harness.files.delete("/repo/AGENTS.md");
      const error = yield* harness
        .provide(
          resolveExternalInstructionSource({
            scan: scanInput(),
            source: readable.sources[0]!.source,
          }),
        )
        .pipe(Effect.flip);
      assert.strictEqual(error.reason, "not-found");
    });
  });

  it.effect("rejects workspace traversal and symlink escapes from trusted roots", () => {
    const harness = makeHarness({
      files: {
        "/outside/AGENTS.md": "outside",
        "/repo/CLAUDE.md": "inside",
      },
      realPaths: {
        "/repo/AGENTS.md": "/outside/AGENTS.md",
        "/repo/link": "/outside",
      },
    });
    return Effect.gen(function* () {
      const result = yield* harness.provide(scanExternalInstructions(scanInput()));
      assert.deepStrictEqual(
        result.sources.map((source) => source.canonicalPath),
        ["/repo/CLAUDE.md"],
      );
      assert.ok(
        result.diagnostics.some(
          (diagnostic) => diagnostic.code === "external-instruction-source-outside-root",
        ),
      );
      const escaped = yield* harness.provide(
        scanExternalInstructions(scanInput({ cwd: "/repo/link" as AbsolutePath })),
      );
      assert.strictEqual(escaped.sources.length, 0);
      assert.ok(
        escaped.diagnostics.some(
          (diagnostic) => diagnostic.code === "external-instruction-workspace-root-invalid",
        ),
      );
    });
  });

  it.effect("resolves by opaque identity and rejects every save as read-only", () => {
    const harness = makeHarness({ files: { "/repo/AGENTS.md": "rules" } });
    return Effect.gen(function* () {
      const scan = yield* harness.provide(scanExternalInstructions(scanInput()));
      const source = scan.sources[0]!;
      const resolved = yield* harness.provide(
        resolveExternalInstructionSource({ scan: scanInput(), source: source.source }),
      );
      assert.strictEqual(resolved.content, "rules");
      assert.strictEqual(resolved.observation.id, source.id);
      const saveError = yield* saveExternalInstructionSource({
        source: source.source,
        expectedFingerprint: source.fingerprint,
        text: "changed",
      }).pipe(Effect.flip);
      assert.strictEqual(saveError.reason, "read-only-source");
    });
  });
});

function scanInput(
  overrides: Partial<ExternalInstructionScanInput> = {},
): ExternalInstructionScanInput {
  return {
    workspaceId: "workspace_external_instructions" as WorkspaceId,
    workspaceRoot: "/repo" as AbsolutePath,
    cwd: "/repo/pkg" as AbsolutePath,
    homeDirectory: "/home/test" as AbsolutePath,
    settings: DEFAULT_EXTERNAL_INSTRUCTIONS,
    ...overrides,
  };
}

function settingsWithRoots(
  roots: ExternalInstructionsSettings["globalRoots"],
): ExternalInstructionsSettings {
  return {
    globalRoots: roots,
    globalControls: {},
    workspaceControls: {},
  };
}

function customRoot(id: string, path: string): ExternalInstructionsSettings["globalRoots"][number] {
  return { id, kind: "custom", label: id, path, enabled: true };
}

function makeHarness(input: {
  readonly files?: Record<string, string>;
  readonly realPaths?: Record<string, string>;
}): Harness {
  const files = new Map(Object.entries(input.files ?? {}));
  const unreadable = new Set<string>();
  const realPaths = new Map(Object.entries(input.realPaths ?? {}));
  const directories = new Set<string>(["/", "/repo", "/repo/pkg"]);
  for (const filePath of files.keys()) addDirectoryChain(directories, dirname(filePath));
  for (const [from, to] of realPaths) {
    if (!files.has(from)) addDirectoryChain(directories, from);
    if (!files.has(to)) addDirectoryChain(directories, to);
  }
  const canonical = (target: string): string =>
    realPaths.get(normalize(target)) ?? normalize(target);
  const fs = {
    exists: (target: string) =>
      Effect.succeed(
        files.has(normalize(target)) ||
          directories.has(normalize(target)) ||
          realPaths.has(normalize(target)),
      ),
    realPath: (target: string) => {
      const normalized = normalize(target);
      const resolved = canonical(normalized);
      return files.has(normalized) || directories.has(normalized) || realPaths.has(normalized)
        ? Effect.succeed(resolved)
        : Effect.fail(new Error(`Missing path: ${normalized}`));
    },
    stat: (target: string) => {
      const normalized = normalize(target);
      return files.has(normalized)
        ? Effect.succeed({ type: "File" } as FileSystem.File.Info)
        : directories.has(normalized)
          ? Effect.succeed({ type: "Directory" } as FileSystem.File.Info)
          : Effect.fail(new Error(`Missing path: ${normalized}`));
    },
    readFileString: (target: string) => {
      const normalized = normalize(target);
      if (unreadable.has(normalized)) return Effect.fail(new Error(`Unreadable: ${normalized}`));
      const content = files.get(normalized);
      return content === undefined
        ? Effect.fail(new Error(`Missing file: ${normalized}`))
        : Effect.succeed(content);
    },
  } as unknown as FileSystem.FileSystem;
  const crypto = Crypto.make({
    digest: (_algorithm, bytes) => Effect.succeed(testDigest(bytes)),
    randomBytes: (size) => new Uint8Array(size),
  });
  return {
    files,
    unreadable,
    realPaths,
    directories,
    provide: (effect) =>
      effect.pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provide(Path.layer),
      ),
  };
}

function testDigest(bytes: Uint8Array): Uint8Array {
  const digest = new Uint8Array(32);
  for (const [index, byte] of bytes.entries()) {
    digest[index % digest.length] = (digest[index % digest.length]! * 33 + byte) % 256;
  }
  return digest;
}

function normalize(target: string): string {
  const parts: string[] = [];
  for (const part of target.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function dirname(target: string): string {
  const normalized = normalize(target);
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function addDirectoryChain(directories: Set<string>, target: string): void {
  let current = normalize(target);
  while (true) {
    directories.add(current);
    if (current === "/") break;
    current = dirname(current);
  }
}
