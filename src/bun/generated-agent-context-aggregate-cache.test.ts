import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  createExtensionContextFingerprints,
  createExternalInstructionsFingerprint,
  createGeneratedAgentContextAggregateCache,
  GENERATED_AGENT_CONTEXT_AGGREGATE_FORMAT_VERSION,
} from "./generated-agent-context-aggregate-cache";
import type { ResolvedExtensionRecord } from "./svvyx-extensions-command";

const tempDirs: string[] = [];

function createTempExtensionsRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "svvy-agent-context-aggregates-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("generated agent context aggregate cache", () => {
  it("writes an indexed aggregate blob and reuses validated cache hits", () => {
    const extensionsRoot = createTempExtensionsRoot();
    const cache = createGeneratedAgentContextAggregateCache({ extensionsRoot });
    let renderCount = 0;
    const inputs = baseInputs();

    const first = cache.getOrCreate(inputs, () => {
      renderCount += 1;
      return outputs("prompt-v1");
    });
    const second = cache.getOrCreate(inputs, () => {
      renderCount += 1;
      return outputs("prompt-v2");
    });

    expect(first.hit).toBe(false);
    expect(second.hit).toBe(true);
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(second.outputs.prompt).toBe("prompt-v1");
    expect(renderCount).toBe(1);
    expect(existsSync(join(extensionsRoot, "generated", "aggregates", "index.sqlite"))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(
        join(extensionsRoot, "generated", "aggregates", "blobs", first.cacheKey, "manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.cacheKey).toBe(first.cacheKey);
  });

  it("regenerates corrupt or deleted blobs without treating cache deletion as product data loss", () => {
    const extensionsRoot = createTempExtensionsRoot();
    const cache = createGeneratedAgentContextAggregateCache({ extensionsRoot });
    const inputs = baseInputs();
    const first = cache.getOrCreate(inputs, () => outputs("original-prompt"));

    writeFileSync(
      join(extensionsRoot, "generated", "aggregates", "blobs", first.cacheKey, "prompt.md"),
      "corrupt-prompt",
    );
    const regenerated = cache.getOrCreate(inputs, () => outputs("regenerated-prompt"));
    expect(regenerated.hit).toBe(false);
    expect(regenerated.outputs.prompt).toBe("regenerated-prompt");

    rmSync(join(extensionsRoot, "generated", "aggregates", "blobs", first.cacheKey), {
      recursive: true,
      force: true,
    });
    const afterSafeDeletion = cache.getOrCreate(inputs, () => outputs("after-safe-deletion"));
    expect(afterSafeDeletion.hit).toBe(false);
    expect(afterSafeDeletion.outputs.prompt).toBe("after-safe-deletion");
  });

  it("changes cache keys when resolved extension or external instruction inputs change", () => {
    const extensionsRoot = createTempExtensionsRoot();
    const cache = createGeneratedAgentContextAggregateCache({ extensionsRoot });
    const first = cache.getOrCreate(baseInputs(), () => outputs("first"));
    const second = cache.getOrCreate(
      {
        ...baseInputs(),
        extensionContextFingerprints: { shell: "changed-fingerprint" },
      },
      () => outputs("second"),
    );
    const third = cache.getOrCreate(
      {
        ...baseInputs(),
        externalInstructionsFingerprint: createExternalInstructionsFingerprint([
          {
            id: "workspace-agents",
            kind: "AGENTS.md",
            title: "AGENTS.md",
            path: "/repo/AGENTS.md",
            content: "Use repo instructions.",
            contentHash: "hash-001",
            order: 0,
            enabled: true,
            actors: ["orchestrator", "handler", "workflow-task"],
            sourceGroup: "workspace_chain",
            readStatus: { status: "readable" },
          },
        ]),
      },
      () => outputs("third"),
    );

    expect(second.cacheKey).not.toBe(first.cacheKey);
    expect(third.cacheKey).not.toBe(first.cacheKey);
  });

  it("fingerprints user extension build context separately from builtin record metadata", () => {
    expect(
      createExtensionContextFingerprints([
        extensionRecord({ id: "linear", extensionBuildFingerprint: "source-build-001" }),
        extensionRecord({ id: "shell", extensionBuildFingerprint: null }),
      ]),
    ).toMatchObject({
      linear: "source-build-001",
    });
  });

  it("prunes old eligible blobs with least-recently-used eviction under the byte budget", () => {
    const extensionsRoot = createTempExtensionsRoot();
    let now = Date.UTC(2026, 0, 1);
    const cache = createGeneratedAgentContextAggregateCache({
      extensionsRoot,
      maxSizeBytes: 2_500,
      now: () => new Date(now),
      unusedEligibilityMs: -1,
    });

    const first = cache.getOrCreate(baseInputs("first"), () => outputs("x".repeat(2_000)));
    now += 1_000;
    const second = cache.getOrCreate(baseInputs("second"), () => outputs("small"));

    const rows = cache.listRows();
    expect(rows.map((row) => row.cache_key)).toEqual([second.cacheKey]);
    expect(
      existsSync(join(extensionsRoot, "generated", "aggregates", "blobs", first.cacheKey)),
    ).toBe(false);
  });
});

function baseInputs(id = "shell") {
  return {
    actorKind: "orchestrator" as const,
    loadedExtensionIds: [id],
    availableExtensionIds: ["extension-managing"],
    loadedContextKeys: [],
    extensionContextFingerprints: { [id]: `${id}-fingerprint` },
    generatedAgentContextContentKey: "generated-context-v1",
    agentContextFormatVersion: GENERATED_AGENT_CONTEXT_AGGREGATE_FORMAT_VERSION,
    externalInstructionsFingerprint: createExternalInstructionsFingerprint([]),
    promptSettingsFingerprint: "prompt-settings-v1",
    workspaceKey: "/workspace",
  };
}

function outputs(prompt: string) {
  return {
    prompt,
    svvyxGuidance: "svvyx guidance",
    commandsDts: "declare const extensions: {};",
    nativeToolSchemasJson: '{"nativeTools":[]}\n',
  };
}

function extensionRecord(input: {
  id: string;
  extensionBuildFingerprint: string | null;
}): ResolvedExtensionRecord {
  return {
    id: input.id,
    category: input.id === "linear" ? "user" : "builtin",
    interface: input.id === "linear" ? "svvyx" : "native_tool",
    title: input.id,
    description: `${input.id} description`,
    instructionSourceFiles: [`/${input.id}/instructions.md`],
    minimalLoadingHint: `${input.id} hint`,
    typescriptApiEnabled: input.id === "linear",
    envReadiness: "not_required",
    dependencyReadiness: "ready",
    resetBehavior: input.id === "linear" ? "user_reset" : "builtin_reset",
    deleteBehavior: input.id === "linear" ? "trash_allowed" : "not_allowed",
    extensionBuildFingerprint: input.extensionBuildFingerprint,
  };
}
