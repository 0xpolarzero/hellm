import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type {
  AbsolutePath,
  BuildGeneratedContextInput,
  ExtensionId,
  ExtensionRegistryObservationResult,
  SourceFingerprint,
} from "@svvy/core";
import {
  buildGeneratedContextArtifacts,
  type BuildGeneratedContextSources,
  type GeneratedContextSourceContributor,
} from "./generated-context";

describe("generated context", () => {
  it.effect(
    "assembles ordered MDX, external instructions, tools, svvyx, declarations, and fingerprints",
    () =>
      Effect.gen(function* () {
        const first = yield* buildGeneratedContextArtifacts(input(), sources()).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
        );
        const second = yield* buildGeneratedContextArtifacts(input(), sources()).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
        );

        assert.strictEqual(first.generatedContext.fingerprint, second.generatedContext.fingerprint);
        assert.deepStrictEqual(
          first.generatedContext.promptBlocks.map((block) => block.contributorId),
          ["base", "shell"],
        );
        assert.deepStrictEqual(
          first.generatedContext.externalInstructionBlocks.map((block) => block.sourceRecordId),
          ["external-instructions#workspace-agents"],
        );
        assert.deepStrictEqual(
          first.generatedContext.nativeToolDeclarations.map((tool) => tool.name),
          ["exec_command", "write_stdin"],
        );
        assert.deepStrictEqual(
          first.generatedContext.svvyxGuidanceBlocks.map((block) => block.extensionId),
          ["artifacts"] as ExtensionId[],
        );
        assert.deepStrictEqual(
          first.generatedContext.executeTypescriptFacadeDeclarations.emittedExtensionIds,
          ["artifacts"] as ExtensionId[],
        );
        assert.match(first.systemPrompt, /Shared rules/);
        assert.match(first.systemPrompt, /Workspace instructions/);
        assert.match(first.systemPrompt, /svvyx artifacts/);
        assert.isAbove(first.generatedContext.tokenEstimate, 0);
        assert.deepStrictEqual(
          first.extensions.map((row) => [row.extensionId, row.state]),
          [
            ["base-common", "loaded"],
            ["shell", "loaded"],
            ["artifacts", "loaded"],
            ["notes", "available"],
          ],
        );
        assert.strictEqual(first.extensions.at(-1)?.instruction, "Load Notes when needed.");
        assert.strictEqual(first.extensions.at(-1)?.loadedInstruction, "Detailed Notes guidance.");
      }),
  );

  it.effect("fails closed for unready loaded extensions and executable MDX", () =>
    Effect.gen(function* () {
      const unready = yield* Effect.exit(
        buildGeneratedContextArtifacts(input(), {
          ...sources(),
          contextReadyExtensionIds: ["base-common", "artifacts"] as ExtensionId[],
        }).pipe(Effect.provideService(Crypto.Crypto, crypto)),
      );
      assert.strictEqual(unready._tag, "Failure");

      const executable = yield* Effect.exit(
        buildGeneratedContextArtifacts(input(), {
          ...sources(),
          contributors: sources().contributors.map((source) =>
            source.contributorId === "base"
              ? { ...source, text: 'import Widget from "./Widget"\n<Widget />' }
              : source,
          ),
        }).pipe(Effect.provideService(Crypto.Crypto, crypto)),
      );
      assert.strictEqual(executable._tag, "Failure");
    }),
  );
});

const crypto = Crypto.make({
  digest: (_algorithm, data) => {
    const output = new Uint8Array(32);
    for (const [index, byte] of data.entries()) {
      const outputIndex = index % output.length;
      output[outputIndex] = (output[outputIndex] ?? 0) ^ byte;
    }
    return Effect.succeed(output);
  },
  randomBytes: (size) => new Uint8Array(size).fill(7),
});

function input(): BuildGeneratedContextInput {
  return {
    actorKind: "orchestrator",
    target: { kind: "profile-preview", workspaceId: "workspace_01" as never },
    actorBinding: {
      actorKind: "orchestrator",
      loadedExtensionIds: ["base-common", "shell", "artifacts"] as ExtensionId[],
      availableExtensionIds: ["notes"] as ExtensionId[],
      unavailableExtensionIds: [],
      instructionOrder: ["base-common", "shell", "artifacts"] as ExtensionId[],
      source: "profile-default",
    },
    reason: "diagnostics",
  };
}

function sources(): BuildGeneratedContextSources {
  return {
    registry: {
      aggregateFingerprint: "registry-01",
      observations: [
        observation("base-common", "instructions"),
        observation("shell", "native_tool"),
        observation("artifacts", "svvyx", true),
        observation("notes", "instructions", false, "user"),
      ],
      diagnostics: [],
    } as ExtensionRegistryObservationResult,
    contributors: [
      contributor(
        "base-common",
        "base",
        "instruction",
        "/base/instructions/full/base.mdx",
        "Shared rules.",
      ),
      contributor(
        "shell",
        "shell",
        "instruction",
        "/shell/instructions/full/shell.mdx",
        "Use Shell.",
      ),
      contributor(
        "artifacts",
        "artifacts-cli",
        "svvyx-guidance",
        "/artifacts/instructions/full/cli.mdx",
        "Use svvyx artifacts.",
      ),
      contributor(
        "notes",
        "notes-minimal",
        "minimal",
        "/notes/instructions/minimal.mdx",
        "Load Notes when needed.",
      ),
      contributor(
        "notes",
        "notes-full",
        "instruction",
        "/notes/instructions/full/notes.mdx",
        "Detailed Notes guidance.",
      ),
      contributor(
        "external-instructions",
        "workspace-agents",
        "external-instruction",
        "/workspace/AGENTS.md",
        "Workspace instructions.",
      ),
    ],
    contextReadyExtensionIds: ["base-common", "shell", "artifacts", "notes"] as ExtensionId[],
    requestInputVariant: "nonblocking",
  };
}

function observation(
  id: string,
  interfaceKind: "instructions" | "native_tool" | "svvyx",
  typescriptApiEnabled = false,
  category: "builtin" | "user" = "builtin",
) {
  return {
    extensionId: id,
    category,
    interfaceKind,
    title: id === "base-common" ? "Base Common" : id[0]!.toUpperCase() + id.slice(1),
    description: `${id} description`,
    capabilities: { typescriptApiEnabled },
  } as unknown as ExtensionRegistryObservationResult["observations"][number];
}

function contributor(
  extensionId: string,
  contributorId: string,
  kind: GeneratedContextSourceContributor["kind"],
  sourcePath: string,
  text: string,
): GeneratedContextSourceContributor {
  const base = {
    contributorId,
    sourceRecordId: `${extensionId}#${contributorId}`,
    sourceVersion: `sha256:${contributorId}-version` as SourceFingerprint,
    sourcePath: sourcePath as AbsolutePath,
    sourceFingerprint: `sha256:${contributorId}` as SourceFingerprint,
    kind,
    bypassed: false,
    text,
  };
  return kind === "external-instruction"
    ? { ...base, kind }
    : { ...base, extensionId: extensionId as ExtensionId, kind };
}
