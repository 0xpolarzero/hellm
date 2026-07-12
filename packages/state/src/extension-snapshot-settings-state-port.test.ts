import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentProfileId,
  ApplyExtensionSnapshotSettingsCommand,
  ExtensionEnvName,
  ExtensionEnvSecretRef,
  ExtensionId,
  ModelId,
  ProviderId,
} from "@svvy/core";

import { runTestEffect } from "./effect.test-support";
import { extensionSnapshotSettingsStatePortFromStore } from "./extension-snapshot-settings-state-port";
import { createStructuredSessionStateStore } from "./structured-session-state";

describe("extension snapshot settings state port", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  function options(directory: string) {
    return {
      databasePath: join(directory, "state.sqlite"),
      now: () => "2026-07-12T10:00:00.000Z",
      workspace: {
        id: "snapshot-settings-test",
        label: "snapshot settings",
        cwd: directory,
        artifactDir: join(directory, "artifacts"),
      },
    };
  }

  function seed(store: ReturnType<typeof createStructuredSessionStateStore>) {
    store.updateOrchestratorProfile({
      profile: {
        profileId: "profile-one" as AgentProfileId,
        name: "Preserved name",
        providerId: "openai" as ProviderId,
        modelId: "gpt-5.4" as ModelId,
        reasoning: { effort: "high" },
        followComposer: true,
        extensionUsage: { ["old" as ExtensionId]: "loaded" },
        extensionOrder: ["old" as ExtensionId],
      },
    });
    store.setAgentActorExtensionDefaults({
      actor: "orchestrator",
      extensionUsage: { old: "available" },
      extensionOrder: ["old"],
    });
    store.reconcileExtensionEnvDeclarations({
      declarations: [
        {
          extensionId: "demo",
          envName: "PUBLIC",
          required: false,
          secret: false,
          description: null,
        },
        { extensionId: "demo", envName: "TOKEN", required: true, secret: true, description: null },
      ],
    });
    store.setExtensionEnvOverride({
      extensionId: "demo" as ExtensionId,
      envName: "PUBLIC" as ExtensionEnvName,
      value: "old-value",
    });
    const ref = {
      kind: "extension-env",
      extensionId: "demo",
      envName: "TOKEN" as ExtensionEnvName,
      materialId: "material-one",
    } as ExtensionEnvSecretRef;
    store.commitExtensionEnvSecretSet({
      command: {
        clientRequestId: "seed-secret",
        extensionId: "demo" as ExtensionId,
        envName: "TOKEN",
        secretValue: "never persisted here",
      } as never,
      ref,
      revisionFingerprint: "secret-revision-one",
      previous: null,
    });
    return ref;
  }

  it("captures exact path-free settings and secret presence without values", async () => {
    const directory = mkdtempSync(join(tmpdir(), "svvy-snapshot-settings-capture-"));
    directories.push(directory);
    const store = createStructuredSessionStateStore(options(directory));
    seed(store);
    const facts = await runTestEffect(
      extensionSnapshotSettingsStatePortFromStore(store).readCaptureFacts(),
    );
    expect(facts.actorSettings[0]?.actor).toBe("orchestrator");
    expect(facts.actorSettings[0]?.extensionOrder.map(String)).toEqual(["old"]);
    const capturedProfile = facts.profileSettings.find(
      (profile) => profile.profileId === "profile-one",
    );
    expect(capturedProfile?.profileId).toBe("profile-one");
    expect(capturedProfile?.extensionOrder.map(String)).toEqual(["old"]);
    expect(facts.nonSecretEnvOverrideScopes.map(String)).toEqual(["demo"]);
    expect(
      facts.nonSecretEnvOverrides.map((entry) => ({
        ...entry,
        extensionId: String(entry.extensionId),
      })),
    ).toEqual([{ extensionId: "demo", envName: "PUBLIC", value: "old-value" }]);
    expect(
      facts.secretTargets.map((entry) => ({
        ...entry,
        extensionId: String(entry.extensionId),
      })),
    ).toEqual([{ extensionId: "demo", envName: "TOKEN", present: true }]);
    expect(JSON.stringify(facts)).not.toContain("never persisted here");
    expect(JSON.stringify(facts)).not.toContain(directory);
    store.close();
  });

  it("applies exact captured scopes idempotently, skips missing profiles, and survives reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "svvy-snapshot-settings-apply-"));
    directories.push(directory);
    let store = createStructuredSessionStateStore(options(directory));
    const secretRef = seed(store);
    const port = extensionSnapshotSettingsStatePortFromStore(store);
    const input = {
      clientRequestId: "apply-settings-one",
      appliedAt: "2026-07-12T11:00:00.000Z",
      payload: {
        schemaVersion: 1,
        capturedAt: "2026-07-12T09:00:00.000Z",
        sources: [],
        actorSettings: [
          {
            actor: "orchestrator",
            extensionOrder: ["new"],
            extensionUsage: [{ extensionId: "new", usage: "loaded" }],
          },
        ],
        profileSettings: [
          {
            actor: "orchestrator",
            profileId: "profile-one",
            extensionOrder: ["new"],
            extensionUsage: [{ extensionId: "new", usage: "available" }],
          },
          {
            actor: "handler",
            profileId: "missing-profile",
            extensionOrder: [],
            extensionUsage: [],
          },
        ],
        nonSecretEnvOverrideScopes: ["demo"],
        nonSecretEnvOverrides: [],
        secretTargets: [{ extensionId: "demo", envName: "TOKEN", present: false }],
      },
    } as unknown as ApplyExtensionSnapshotSettingsCommand;
    const applied = await runTestEffect(port.applyCapturedSettings(input));
    expect(applied.value).toMatchObject({
      appliedActorCount: 1,
      appliedProfileCount: 1,
      skippedProfileIds: ["missing-profile"],
      appliedOverrideCount: 0,
      deferredSecretTargetCount: 1,
    });
    expect(applied.afterCommit).toEqual([
      { scope: "app", invalidation: { model: "extensions" } },
      { scope: "app", invalidation: { model: "agents" } },
    ]);
    const duplicate = await runTestEffect(port.applyCapturedSettings(input));
    expect(duplicate.value.receipt.outcome).toBe("duplicate");
    expect(duplicate.afterCommit).toEqual([]);
    expect(store.listExtensionEnvOverrides()).toEqual([]);
    expect(store.listExtensionEnvSecrets()[0]?.ref).toEqual(secretRef);
    store.close();

    store = createStructuredSessionStateStore(options(directory));
    expect(store.listAgentActorExtensionDefaults()[0]).toMatchObject({
      extensionUsage: { new: "loaded" },
      extensionOrder: ["new"],
    });
    expect(
      store.listAgentProfiles().find((profile) => profile.profileId === "profile-one"),
    ).toMatchObject({
      name: "Preserved name",
      providerId: "openai",
      modelId: "gpt-5.4",
      reasoning: { effort: "high" },
      followComposer: true,
      extensionUsage: { new: "available" },
      extensionOrder: ["new"],
    });
    expect(
      store.listAgentProfiles().some((profile) => profile.profileId === "missing-profile"),
    ).toBe(false);
    expect(store.listExtensionEnvSecrets()[0]?.ref).toEqual(secretRef);
    store.close();
  });
});
