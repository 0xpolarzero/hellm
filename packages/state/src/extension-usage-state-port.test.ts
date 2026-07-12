import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionId, ExtensionUsageChangeId, RuntimeClientRequestId } from "@svvy/core";

import { createStructuredSessionStateStore } from "./structured-session-state";
import { extensionUsageStatePortFromStore } from "./extension-usage-state-port";
import { runTestEffect } from "./effect.test-support";

describe("extension usage SQLite authority", () => {
  const roots: string[] = [];
  afterEach(() =>
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })),
  );

  const open = (root = mkdtempSync(join(tmpdir(), "svvy-extension-usage-"))) => {
    roots.push(root);
    return createStructuredSessionStateStore({
      databasePath: join(root, "state.sqlite"),
      workspace: { id: root, label: "test", cwd: root, artifactDir: join(root, "artifacts") },
    });
  };

  it("records idempotent usage changes and CAS-safe exact reverts across reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-extension-usage-reopen-"));
    let store = open(root);
    let port = extensionUsageStatePortFromStore(store);
    const target = await runTestEffect(port.resolveTarget("default-orchestrator"));
    const set = await runTestEffect(
      port.set({
        clientRequestId: "runtime-client:usage:set" as RuntimeClientRequestId,
        extensionId: "smithers" as ExtensionId,
        target,
        usage: "loaded",
        expectedStateRevision: store.readCurrentStateRevision(),
      }),
    );
    expect(set.value.before).toBeNull();
    expect(set.value.after).toBe("loaded");
    expect(
      store.listAgentProfiles().find((profile) => profile.profileId === "default-orchestrator")
        ?.extensionUsage,
    ).toEqual({ smithers: "loaded" });
    expect(
      (
        await runTestEffect(
          port.set({
            clientRequestId: "runtime-client:usage:set" as RuntimeClientRequestId,
            extensionId: "smithers" as ExtensionId,
            target,
            usage: "loaded",
          }),
        )
      ).value.changeId,
    ).toBe(set.value.changeId);
    await expect(
      runTestEffect(
        port.set({
          clientRequestId: "runtime-client:usage:set" as RuntimeClientRequestId,
          extensionId: "smithers" as ExtensionId,
          target,
          usage: "available",
        }),
      ),
    ).rejects.toThrow("different extension usage mutation");
    store.close();

    store = open(root);
    port = extensionUsageStatePortFromStore(store);
    const reverted = await runTestEffect(
      port.revert({
        clientRequestId: "runtime-client:usage:revert" as RuntimeClientRequestId,
        changeId: set.value.changeId as ExtensionUsageChangeId,
        expectedStateRevision: store.readCurrentStateRevision(),
      }),
    );
    expect(reverted.value.revertedChangeId).toBe(set.value.changeId);
    expect(reverted.value.after).toBeNull();
    expect(
      store.listAgentProfiles().find((profile) => profile.profileId === "default-orchestrator")
        ?.extensionUsage,
    ).toEqual({});
    store.close();
  });

  it("rejects stale revisions and revert conflicts", async () => {
    const store = open();
    const port = extensionUsageStatePortFromStore(store);
    const target = await runTestEffect(port.resolveTarget("threadHandler"));
    await expect(
      runTestEffect(
        port.set({
          clientRequestId: "runtime-client:usage:stale" as RuntimeClientRequestId,
          extensionId: "git" as ExtensionId,
          target,
          usage: "loaded",
          expectedStateRevision: 99 as never,
        }),
      ),
    ).rejects.toThrow("stale");
    const first = await runTestEffect(
      port.set({
        clientRequestId: "runtime-client:usage:first" as RuntimeClientRequestId,
        extensionId: "git" as ExtensionId,
        target,
        usage: "loaded",
      }),
    );
    await runTestEffect(
      port.set({
        clientRequestId: "runtime-client:usage:second" as RuntimeClientRequestId,
        extensionId: "git" as ExtensionId,
        target,
        usage: "available",
      }),
    );
    await expect(
      runTestEffect(
        port.revert({
          clientRequestId: "runtime-client:usage:conflict" as RuntimeClientRequestId,
          changeId: first.value.changeId,
        }),
      ),
    ).rejects.toThrow("changed after");
    store.close();
  });
});
