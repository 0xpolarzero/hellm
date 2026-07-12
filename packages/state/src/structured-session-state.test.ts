import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RUNTIME_TURN_DECISIONS,
  type AbsolutePath,
  type ThreadId,
  type WorkspaceId,
  type WorkspacePaneId,
  type WorkspaceSessionId,
  type WorkspaceTabId,
} from "@svvy/core";
import * as Effect from "effect/Effect";
import { StateContractError } from "@svvy/core";
import {
  STRUCTURED_TURN_DECISIONS,
  StructuredSessionState,
  createStructuredSessionStateStore,
  layerStructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

function createDeterministicClock(start = "2026-04-18T09:00:00.000Z") {
  let cursor = Date.parse(start);
  return () => {
    const next = new Date(cursor).toISOString();
    cursor += 1_000;
    return next;
  };
}

const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

function seedSession(store: StructuredSessionStateStore, sessionId = "session-001") {
  store.upsertPiSession({
    sessionId,
    title: "Structured session smoke",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "high",
    messageCount: 3,
    status: "idle",
    createdAt: "2026-04-18T08:55:00.000Z",
    updatedAt: "2026-04-18T08:56:00.000Z",
  });
}

describe("structured session state write API", () => {
  const stores: StructuredSessionStateStore[] = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    while (stores.length > 0) {
      stores.pop()?.close();
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { force: true, recursive: true });
      }
    }
  });

  function createStore() {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "svvy-structured-store-"));
    tempDirs.push(workspaceCwd);
    const store = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: {
        id: workspaceCwd,
        label: "svvy",
        cwd: workspaceCwd,
        artifactDir: join(workspaceCwd, "artifact-store"),
      },
      now: createDeterministicClock(),
    });
    stores.push(store);
    return store;
  }

  it("keeps the current top-level turn decision inventory aligned with the product spec", () => {
    expect([...STRUCTURED_TURN_DECISIONS]).toEqual(["pending", ...RUNTIME_TURN_DECISIONS]);
  });

  it("persists renderer-safe parent session identity for fork navigation", () => {
    const store = createStore();
    store.upsertPiSession({
      sessionId: "session-fork-child",
      parentSessionId: "session-fork-parent",
      title: "Fork child",
      messageCount: 1,
      status: "idle",
      createdAt: "2026-04-18T08:55:00.000Z",
      updatedAt: "2026-04-18T08:56:00.000Z",
    });

    expect(store.getSessionState("session-fork-child").pi.parentSessionId).toBe(
      "session-fork-parent",
    );
  });

  it("persists app chrome identity and atomic workspace slots without tab-scoped layout copies", () => {
    const store = createStore();
    const workspaceId = store.workspaceId as WorkspaceId;
    const initial = store.readWorkspaceLayout(workspaceId);

    expect(initial.slots.map((slot) => [slot.layoutId, slot.initialized, slot.updatedAt])).toEqual([
      ["A", false, "1970-01-01T00:00:00.000Z"],
      ["B", false, "1970-01-01T00:00:00.000Z"],
      ["C", false, "1970-01-01T00:00:00.000Z"],
    ]);
    expect(store.readWorkspaceLayout(workspaceId)).toEqual(initial);

    const firstTab = {
      workspaceTabId: "workspace-tab-layout-first" as WorkspaceTabId,
      workspaceId,
      cwd: store.getWorkspaceRecord().cwd as AbsolutePath,
      workspaceLabel: "Layout first",
      kind: "user" as const,
      openedAt: "2026-04-18T08:00:00.000Z" as never,
      activeLayoutId: "A" as const,
    };
    const duplicateTab = {
      ...firstTab,
      workspaceTabId: "workspace-tab-layout-duplicate" as WorkspaceTabId,
      workspaceLabel: "Layout duplicate",
      openedAt: "2026-04-18T08:01:00.000Z" as never,
    };
    store.setWorkspaceTabs({
      activeWorkspaceTabId: duplicateTab.workspaceTabId,
      tabs: [firstTab, duplicateTab],
      knownWorkspaces: [firstTab],
    });
    expect(store.readWorkspaceChrome()).toMatchObject({
      activeWorkspaceTabId: duplicateTab.workspaceTabId,
      tabs: [firstTab, duplicateTab],
      knownWorkspaces: [firstTab],
    });

    store.saveWorkspaceLayoutSlot({
      workspaceId,
      layoutId: "A",
      dockviewJson: { grid: null },
      panes: [],
      compactSurfaces: [],
      focusedPaneId: null,
    });
    expect(store.readWorkspaceLayout(workspaceId).slots[0]?.initialized).toBe(false);

    const firstPane = {
      paneId: "pane-layout-first" as WorkspacePaneId,
      target: { surface: "open-workspace" as const },
      localState: { scroll: null, timelineDensity: "comfortable" as const },
      fallbackChrome: null,
      placement: null,
      restore: { kind: "ready" as const },
    };
    const restoredPane = {
      paneId: "pane-layout-restored" as WorkspacePaneId,
      target: {
        surface: "app-logs" as const,
        workspaceSessionId: "session-layout-restored" as WorkspaceSessionId,
      },
      localState: {
        scroll: { transcriptAnchorId: null, offsetPx: -9.5 },
        timelineDensity: "compact" as const,
      },
      fallbackChrome: {
        title: "Logs",
        subtitle: "Session logs",
        kind: "app-logs" as const,
      },
      placement: {
        kind: "popout" as const,
        box: { left: -1200, top: 40, width: 900, height: 700 },
      },
      restore: {
        kind: "unavailable" as const,
        reason: "The session is unavailable.",
        lastKnownLocationLabel: "Popout 1",
      },
    };
    store.saveWorkspaceLayoutSlot({
      workspaceId,
      layoutId: "A",
      dockviewJson: { grid: { root: null } },
      panes: [firstPane, restoredPane],
      compactSurfaces: [
        {
          kind: "compact-thread",
          workspaceSessionId: "session-layout-restored" as WorkspaceSessionId,
          threadId: "thread-layout-restored" as ThreadId,
          panelId: restoredPane.paneId,
          density: "compact",
        },
      ],
      focusedPaneId: restoredPane.paneId,
    });
    expect(store.readWorkspaceLayout(workspaceId).slots[0]).toMatchObject({
      initialized: true,
      panes: [firstPane, restoredPane],
      compactSurfaces: [expect.objectContaining({ panelId: restoredPane.paneId })],
    });

    store.saveWorkspaceLayoutSlot({
      workspaceId,
      layoutId: "A",
      dockviewJson: null,
      panes: [],
      compactSurfaces: [],
      focusedPaneId: null,
    });
    const replaced = store.readWorkspaceLayout(workspaceId).slots[0];
    expect(replaced).toMatchObject({
      initialized: true,
      dockviewJson: null,
      panes: [],
      compactSurfaces: [],
      focusedPaneId: null,
    });
    expect(store.readWorkspaceLayout(workspaceId).slots).toHaveLength(3);
  });

  it("orders stale full chrome writes behind atomic granular selections and missing targets", () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "svvy-workspace-chrome-order-"));
    tempDirs.push(workspaceCwd);
    const databasePath = join(workspaceCwd, "state.sqlite");
    const options = {
      databasePath,
      busyTimeoutMs: 1_000,
      digest: testDigest,
      workspace: {
        id: workspaceCwd,
        label: "Workspace chrome ordering",
        cwd: workspaceCwd,
        artifactDir: join(workspaceCwd, "artifact-store"),
      },
      now: createDeterministicClock(),
    };
    const primary = createStructuredSessionStateStore(options);
    const concurrent = createStructuredSessionStateStore({
      ...options,
      now: createDeterministicClock("2026-04-18T10:00:00.000Z"),
    });
    stores.push(primary, concurrent);
    const workspaceId = primary.workspaceId as WorkspaceId;
    const firstTab = {
      workspaceTabId: "workspace-tab-order-first" as WorkspaceTabId,
      workspaceId,
      cwd: workspaceCwd as AbsolutePath,
      workspaceLabel: "First",
      kind: "user" as const,
      openedAt: "2026-04-18T08:00:00.000Z" as never,
      activeLayoutId: "A" as const,
    };
    const secondTab = {
      ...firstTab,
      workspaceTabId: "workspace-tab-order-second" as WorkspaceTabId,
      workspaceLabel: "Second",
      openedAt: "2026-04-18T08:01:00.000Z" as never,
    };
    const staleFullState = {
      activeWorkspaceTabId: firstTab.workspaceTabId,
      tabs: [firstTab, secondTab],
      knownWorkspaces: [firstTab, secondTab],
    };

    expect(primary.setWorkspaceTabs(staleFullState).outcome).toBe("committed");
    expect(
      primary.selectWorkspaceLayoutSlot({
        workspaceTabId: firstTab.workspaceTabId,
        layoutId: "B",
      }).outcome,
    ).toBe("committed");
    expect(primary.selectWorkspaceTab({ workspaceTabId: secondTab.workspaceTabId }).outcome).toBe(
      "committed",
    );
    const revisionAfterGranularSelections = primary.readCurrentStateRevision();

    expect(concurrent.setWorkspaceTabs(staleFullState)).toMatchObject({
      outcome: "no-op",
      stateRevision: revisionAfterGranularSelections,
    });
    expect(primary.readWorkspaceChrome()).toMatchObject({
      activeWorkspaceTabId: secondTab.workspaceTabId,
      tabs: [
        expect.objectContaining({ workspaceTabId: firstTab.workspaceTabId, activeLayoutId: "B" }),
        expect.objectContaining({ workspaceTabId: secondTab.workspaceTabId, activeLayoutId: "A" }),
      ],
      knownWorkspaces: [
        expect.objectContaining({ workspaceTabId: firstTab.workspaceTabId, activeLayoutId: "B" }),
        expect.objectContaining({ workspaceTabId: secondTab.workspaceTabId, activeLayoutId: "A" }),
      ],
    });
    expect(
      concurrent.selectWorkspaceLayoutSlot({
        workspaceTabId: firstTab.workspaceTabId,
        layoutId: "B",
      }).outcome,
    ).toBe("no-op");
    expect(
      concurrent.selectWorkspaceTab({ workspaceTabId: secondTab.workspaceTabId }).outcome,
    ).toBe("no-op");

    primary.setWorkspaceTabs({
      activeWorkspaceTabId: null,
      tabs: [],
      knownWorkspaces: [],
    });
    const revisionAfterRemoval = primary.readCurrentStateRevision();
    for (const select of [
      () => concurrent.selectWorkspaceTab({ workspaceTabId: firstTab.workspaceTabId }),
      () =>
        concurrent.selectWorkspaceLayoutSlot({
          workspaceTabId: firstTab.workspaceTabId,
          layoutId: "C",
        }),
    ]) {
      expect(select).toThrow(StateContractError);
      try {
        select();
      } catch (error) {
        expect(error).toMatchObject({ reason: "not-found" });
      }
    }
    expect(primary.readCurrentStateRevision()).toBe(revisionAfterRemoval);
  });

  it("honors the requested active tab when a full write changes the tab collection", () => {
    const store = createStore();
    const workspaceId = store.workspaceId as WorkspaceId;
    const firstTab = {
      workspaceTabId: "workspace-tab-compound-first" as WorkspaceTabId,
      workspaceId,
      cwd: store.getWorkspaceRecord().cwd as AbsolutePath,
      workspaceLabel: "Compound first",
      kind: "user" as const,
      openedAt: "2026-04-18T08:00:00.000Z" as never,
      activeLayoutId: "A" as const,
    };
    const secondTab = {
      ...firstTab,
      workspaceTabId: "workspace-tab-compound-second" as WorkspaceTabId,
      workspaceLabel: "Compound second",
      openedAt: "2026-04-18T08:01:00.000Z" as never,
    };

    store.setWorkspaceTabs({
      activeWorkspaceTabId: firstTab.workspaceTabId,
      tabs: [firstTab],
      knownWorkspaces: [firstTab],
    });
    expect(
      store.setWorkspaceTabs({
        activeWorkspaceTabId: secondTab.workspaceTabId,
        tabs: [firstTab, secondTab],
        knownWorkspaces: [firstTab, secondTab],
      }).outcome,
    ).toBe("committed");
    expect(store.readWorkspaceChrome().activeWorkspaceTabId).toBe(secondTab.workspaceTabId);
  });

  it("exposes structured session state through an Effect service and scoped layer", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "svvy-structured-state-effect-"));
    tempDirs.push(workspaceCwd);

    const result = await runTestEffect(
      Effect.gen(function* () {
        const state = yield* StructuredSessionState;
        yield* state.upsertPiSession({
          sessionId: "effect-session",
          title: "Effect session",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          messageCount: 1,
          status: "idle",
          createdAt: "2026-04-18T08:55:00.000Z",
          updatedAt: "2026-04-18T08:56:00.000Z",
        });
        const turn = yield* state.startTurn({
          sessionId: "effect-session",
          surfacePiSessionId: "surface-effect-session",
          requestSummary: "Check the Effect state layer.",
        });
        const snapshot = yield* state.getSessionState("effect-session");
        return {
          databasePath: state.databasePath,
          turn,
          snapshot,
          workspaceId: state.workspaceId,
        };
      }).pipe(
        Effect.provide(
          layerStructuredSessionState({
            workspace: {
              id: workspaceCwd,
              label: "svvy",
              cwd: workspaceCwd,
              artifactDir: join(workspaceCwd, "artifact-store"),
            },
            now: createDeterministicClock(),
            digest: testDigest,
          }),
        ),
      ),
    );

    expect(result.workspaceId).toBe(workspaceCwd);
    expect(result.databasePath).toBe(":memory:");
    expect(result.turn).toMatchObject({
      sessionId: "effect-session",
      surfacePiSessionId: "surface-effect-session",
      requestSummary: "Check the Effect state layer.",
      status: "running",
    });
    expect(result.snapshot.pi.title).toBe("Effect session");
    expect(result.snapshot.turns.map((turn) => turn.id)).toEqual([result.turn.id]);
  });

  it("maps throwing structured store calls to typed Effect state errors", async () => {
    const failure = new Error("structured store offline");
    const failingStore = new Proxy(
      {
        workspaceId: "failing-workspace",
        databasePath: ":memory:",
        close: () => {},
      },
      {
        get(target, property, receiver) {
          if (property in target) {
            return Reflect.get(target, property, receiver);
          }
          return () => {
            throw failure;
          };
        },
      },
    ) as StructuredSessionStateStore;

    const error = await runTestEffect(
      Effect.gen(function* () {
        const state = yield* StructuredSessionState;
        return yield* state.getSessionState("missing-session").pipe(Effect.flip);
      }).pipe(
        Effect.provideService(
          StructuredSessionState,
          structuredSessionStateFromStore(failingStore),
        ),
      ),
    );

    expect(error).toBeInstanceOf(StateContractError);
    expect(error).toMatchObject({
      operation: "structured-session.getSessionState",
      reason: "transaction-failed",
      message: "structured store offline",
      cause: failure,
    });
  });

  it("stores durable generated agent context bindings without replacing older bound payloads", () => {
    const store = createStore();
    seedSession(store, "session-generated-binding");

    const first = store.upsertGeneratedAgentContextBinding({
      surfacePiSessionId: "surface-generated-binding",
      ownerKind: "session",
      ownerId: "session-generated-binding",
      actorKind: "orchestrator",
      aggregateCacheKey: "aggregate-initial",
      systemPrompt: "Use the initial generated context.",
      svvyxGuidance: "Initial svvyx guidance.",
      commandsDts: "declare const initial: true;",
      nativeToolSchemasJson: '{"initial":true}',
      generatedAgentContextFingerprint: "fingerprint-initial",
      generatedAgentContextRevision: 1,
      loadedExtensionIds: ["shell"],
      availableExtensionIds: ["smithers"],
      externalSourceHashes: ["AGENTS.md:initial:true"],
    });
    const second = store.upsertGeneratedAgentContextBinding({
      surfacePiSessionId: "surface-generated-binding",
      ownerKind: "session",
      ownerId: "session-generated-binding",
      actorKind: "orchestrator",
      aggregateCacheKey: "aggregate-changed",
      systemPrompt: "Use the changed generated context.",
      svvyxGuidance: "Changed svvyx guidance.",
      commandsDts: "declare const changed: true;",
      nativeToolSchemasJson: '{"changed":true}',
      generatedAgentContextFingerprint: "fingerprint-changed",
      generatedAgentContextRevision: 2,
      loadedExtensionIds: ["shell", "smithers"],
      availableExtensionIds: [],
      externalSourceHashes: ["AGENTS.md:changed:true"],
    });

    expect(
      store.getGeneratedAgentContextBinding({
        surfacePiSessionId: "surface-generated-binding",
        generatedAgentContextFingerprint: first.generatedAgentContextFingerprint,
      })?.systemPrompt,
    ).toBe("Use the initial generated context.");
    expect(
      store.getGeneratedAgentContextBinding({
        surfacePiSessionId: "surface-generated-binding",
        generatedAgentContextFingerprint: first.generatedAgentContextFingerprint,
      }),
    ).toMatchObject({
      aggregateCacheKey: "aggregate-initial",
      svvyxGuidance: "Initial svvyx guidance.",
      commandsDts: "declare const initial: true;",
      nativeToolSchemasJson: '{"initial":true}',
    });
    expect(
      store.getGeneratedAgentContextBinding({
        surfacePiSessionId: "surface-generated-binding",
        generatedAgentContextFingerprint: second.generatedAgentContextFingerprint,
      })?.loadedExtensionIds,
    ).toEqual(["shell", "smithers"]);
    expect(
      store.getGeneratedAgentContextBinding({
        surfacePiSessionId: "surface-generated-binding",
      })?.generatedAgentContextFingerprint,
    ).toBe("fingerprint-changed");
  });

  it("stores pinned, archived, and sidebar navigation state without deleting session facts", () => {
    const store = createStore();
    seedSession(store, "session-navigation");

    expect(store.getWorkspaceSidebarState()).toEqual({
      pinnedGroupCollapsed: false,
      pinnedGroupSizePx: 150,
      activeGroupCollapsed: false,
      activeGroupSizePx: 260,
      archivedGroupCollapsed: true,
      archivedGroupSizePx: 190,
      updatedAt: "1970-01-01T00:00:00.000Z",
    });

    store.setSessionPinned({ sessionId: "session-navigation", pinned: true });
    let snapshot = store.getSessionState("session-navigation");
    expect(snapshot.session.pinnedAt).toBe("2026-04-18T09:00:00.000Z");
    expect(snapshot.session.archivedAt).toBeNull();

    store.setSessionArchived({ sessionId: "session-navigation", archived: true });
    snapshot = store.getSessionState("session-navigation");
    expect(snapshot.session.pinnedAt).toBeNull();
    expect(snapshot.session.archivedAt).toBe("2026-04-18T09:00:01.000Z");
    expect(snapshot.pi.title).toBe("Structured session smoke");

    store.setSessionArchived({ sessionId: "session-navigation", archived: false });
    snapshot = store.getSessionState("session-navigation");
    expect(snapshot.session.pinnedAt).toBeNull();
    expect(snapshot.session.archivedAt).toBeNull();

    store.markSessionUnread({
      sessionId: "session-navigation",
      reason: "assistant-turn-finished",
    });
    snapshot = store.getSessionState("session-navigation");
    expect(snapshot.session.unreadAt).toBe("2026-04-18T09:00:03.000Z");
    expect(snapshot.session.unreadReason).toBe("assistant-turn-finished");
    expect(snapshot.session.lastReadAt).toBeNull();

    store.markSessionRead({ sessionId: "session-navigation" });
    snapshot = store.getSessionState("session-navigation");
    expect(snapshot.session.unreadAt).toBeNull();
    expect(snapshot.session.unreadReason).toBeNull();
    expect(snapshot.session.lastReadAt).toBe("2026-04-18T09:00:04.000Z");
    expect(
      snapshot.events.filter((event) => event.kind === "session.navigation.updated"),
    ).toHaveLength(3);
    expect(snapshot.events.filter((event) => event.kind === "session.unread.updated")).toHaveLength(
      2,
    );

    expect(
      store.setSessionNavigationSectionState({ section: "archived", collapsed: false }),
    ).toEqual({
      pinnedGroupCollapsed: false,
      pinnedGroupSizePx: 150,
      activeGroupCollapsed: false,
      activeGroupSizePx: 260,
      archivedGroupCollapsed: false,
      archivedGroupSizePx: 190,
      updatedAt: "2026-04-18T09:00:05.000Z",
    });
  });

  it("tracks durable title generation lifecycle and rename locking state", () => {
    const store = createStore();
    seedSession(store, "session-title");

    expect(store.queueTitleGeneration("session-title")?.titleGenerationStatus).toBe("pending");
    let snapshot = store.getSessionState("session-title");
    expect(snapshot.pi.titleGenerationStatus).toBe("pending");
    expect(snapshot.pi.titleGenerationTriggeredAt).toBe("2026-04-18T09:00:00.000Z");
    expect(store.queueTitleGeneration("session-title")).toBeNull();

    store.markTitleGenerationRunning("session-title");
    snapshot = store.getSessionState("session-title");
    expect(snapshot.pi.titleGenerationStatus).toBe("running");

    store.completeTitleGeneration({
      sessionId: "session-title",
      title: "Parser Error Repair",
    });
    snapshot = store.getSessionState("session-title");
    expect(snapshot.pi.title).toBe("Parser Error Repair");
    expect(snapshot.pi.titleGenerationStatus).toBe("completed");
    expect(snapshot.pi.titleAutoFrozen).toBe(true);
    expect(snapshot.pi.titleManualOverride).toBe(false);
    expect(store.queueTitleGeneration("session-title")).toBeNull();
  });

  it("persists and clears surface composer drafts", () => {
    const store = createStore();
    seedSession(store, "session-draft");

    store.setComposerDraft({
      sessionId: "session-draft",
      surfacePiSessionId: "session-draft",
      text: "Inspect parser state before sending",
      attachments: [
        {
          id: "file:docs/prd.md",
          kind: "file",
          name: "prd.md",
          path: "docs/prd.md",
          workspaceRelativePath: "docs/prd.md",
        },
      ],
      snippetMentions: [
        {
          id: "mention-1",
          snippetId: "snippet-review",
          source: "svvy",
          title: "Review Plan",
          token: "@Review Plan",
          body: "Review $1.",
          contentHash: "fnv1a32:example",
          arguments: ["docs/prd.md"],
          metadata: { description: "Review target", argumentHint: "target" },
        },
      ],
    });

    expect(store.getComposerDraft("session-draft")).toEqual(
      expect.objectContaining({
        sessionId: "session-draft",
        surfacePiSessionId: "session-draft",
        threadId: null,
        text: "Inspect parser state before sending",
        snippetMentions: [
          {
            id: "mention-1",
            snippetId: "snippet-review",
            source: "svvy",
            title: "Review Plan",
            token: "@Review Plan",
            body: "Review $1.",
            contentHash: "fnv1a32:example",
            arguments: ["docs/prd.md"],
            metadata: { description: "Review target", argumentHint: "target" },
          },
        ],
        updatedAt: "2026-04-18T09:00:00.000Z",
      }),
    );
    expect(store.getSessionState("session-draft").pi.updatedAt).toBe("2026-04-18T09:00:00.000Z");

    store.setComposerDraft({
      sessionId: "session-draft",
      surfacePiSessionId: "session-draft",
      text: "",
      attachments: [],
    });

    expect(store.getComposerDraft("session-draft")).toBeNull();
  });

  it("freezes auto titles after manual rename and cancels active title generation", () => {
    const store = createStore();
    seedSession(store, "session-manual-title");
    store.queueTitleGeneration("session-manual-title");
    store.markTitleGenerationRunning("session-manual-title");

    store.markManualTitleOverride({
      sessionId: "session-manual-title",
      title: "Manual Title",
    });

    const snapshot = store.getSessionState("session-manual-title");
    expect(snapshot.pi.title).toBe("Manual Title");
    expect(snapshot.pi.titleGenerationStatus).toBe("cancelled");
    expect(snapshot.pi.titleAutoFrozen).toBe(true);
    expect(snapshot.pi.titleManualOverride).toBe(true);
    expect(store.queueTitleGeneration("session-manual-title")).toBeNull();
  });

  it("persists explicit per-turn decisions", () => {
    const store = createStore();
    seedSession(store, "session-turn-decisions");

    const turn = store.startTurn({
      sessionId: "session-turn-decisions",
      surfacePiSessionId: "session-turn-decisions",
      requestSummary: "Route a turn through execute_typescript",
    });
    expect(store.getSessionState("session-turn-decisions").turns[0]?.turnDecision).toBe("pending");

    store.setTurnDecision({
      turnId: turn.id,
      decision: "execute_typescript",
      onlyIfPending: true,
    });
    store.finishTurn({
      turnId: turn.id,
      status: "completed",
    });

    expect(store.getSessionState("session-turn-decisions").turns).toEqual([
      expect.objectContaining({
        id: turn.id,
        turnDecision: "execute_typescript",
        status: "completed",
      }),
    ]);
  });

  it("persists generated agent context fingerprints for sessions and threads", () => {
    const store = createStore();
    store.upsertPiSession({
      sessionId: "session-generated-context",
      title: "Generated context",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "high",
      generatedAgentContextFingerprint: "session-fingerprint-001",
      loadedExtensionIds: ["shell"],
      availableExtensionIds: ["smithers"],
      messageCount: 1,
      status: "idle",
      createdAt: "2026-04-18T08:55:00.000Z",
      updatedAt: "2026-04-18T08:56:00.000Z",
    });

    const turn = store.startTurn({
      sessionId: "session-generated-context",
      surfacePiSessionId: "session-generated-context",
      requestSummary: "Start a handler with generated context",
    });
    const thread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-generated-context",
      title: "Generated context handler",
      objective: "Use the bound generated context.",
      generatedAgentContextFingerprint: "thread-fingerprint-001",
    });

    const snapshot = store.getSessionState("session-generated-context");
    expect(snapshot.pi.generatedAgentContextFingerprint).toBe("session-fingerprint-001");
    expect(snapshot.pi.loadedExtensionIds).toEqual(["shell"]);
    expect(snapshot.pi.availableExtensionIds).toEqual(["smithers"]);
    expect(
      snapshot.threads.find((item) => item.id === thread.id)?.generatedAgentContextFingerprint,
    ).toBe("thread-fingerprint-001");

    const sessionExtensions = store.updatePiSessionExtensionState({
      sessionId: "session-generated-context",
      loadedExtensionIds: ["shell", "smithers"],
      availableExtensionIds: [],
    });
    expect(sessionExtensions.loadedExtensionIds).toEqual(["shell", "smithers"]);
    expect(sessionExtensions.availableExtensionIds).toEqual([]);

    const updated = store.updateThread({
      threadId: thread.id,
      generatedAgentContextFingerprint: "thread-fingerprint-002",
    });
    expect(updated.generatedAgentContextFingerprint).toBe("thread-fingerprint-002");
  });

  it("writes surface-aware turns, handler threads, multiple workflow runs, and a single terminal episode", () => {
    const store = createStore();
    seedSession(store, "session-model");

    const orchestratorTurn = store.startTurn({
      sessionId: "session-model",
      surfacePiSessionId: "session-model",
      requestSummary: "Delegate workflow execution design",
    });
    const handlerThread = store.createThread({
      turnId: orchestratorTurn.id,
      surfacePiSessionId: "pi-thread-001",
      title: "Workflow Execution Design",
      objective: "Own the delegated design task and supervise workflow runs.",
    });
    store.finishTurn({
      turnId: orchestratorTurn.id,
      status: "completed",
    });

    const handlerTurn = store.startTurn({
      sessionId: "session-model",
      surfacePiSessionId: handlerThread.surfacePiSessionId,
      threadId: handlerThread.id,
      requestSummary: "Reuse or author the workflow for the delegated task",
    });

    const startWorkflow = store.createCommand({
      turnId: handlerTurn.id,
      threadId: handlerThread.id,
      toolName: "exec_command",
      executor: "handler",
      visibility: "surface",
      title: "Start workflow",
      summary: "Start the first workflow run.",
    });
    store.startCommand(startWorkflow.id);
    store.finishCommand({
      commandId: startWorkflow.id,
      status: "succeeded",
      summary: "The first workflow run was launched.",
    });

    const runOne = store.recordWorkflow({
      threadId: handlerThread.id,
      commandId: startWorkflow.id,
      smithersRunId: "smithers-run-001",
      workflowName: "design-workflow",
      workflowSource: "artifact",
      entryPath: ".svvy/artifacts/workflows/design-workflow-v1/entries/workflow.tsx",
      savedEntryId: null,
      status: "waiting",
      summary: "Paused for clarification about workflow resume ownership.",
    });

    const workflowArtifact = store.createArtifact({
      workflowRunId: runOne.id,
      sourceCommandId: startWorkflow.id,
      kind: "json",
      name: "run-one.json",
      content: '{"status":"waiting"}',
    });

    store.updateThread({
      threadId: handlerThread.id,
      status: "running-handler",
    });

    const resumeWorkflow = store.createCommand({
      turnId: handlerTurn.id,
      threadId: handlerThread.id,
      toolName: "exec_command",
      executor: "handler",
      visibility: "surface",
      title: "Resume Smithers CLI",
      summary: "Resume the workflow after clarification through Shell.",
    });
    const runTwo = store.recordWorkflow({
      threadId: handlerThread.id,
      commandId: resumeWorkflow.id,
      smithersRunId: "smithers-run-002",
      workflowName: "design-workflow-v2",
      workflowSource: "artifact",
      entryPath: ".svvy/artifacts/workflows/design-workflow-v2/entries/workflow.tsx",
      savedEntryId: null,
      status: "completed",
      summary: "Completed after clarification and repair.",
    });

    const reviewCommand = store.createCommand({
      turnId: handlerTurn.id,
      threadId: handlerThread.id,
      workflowRunId: runTwo.id,
      toolName: "execute_typescript",
      executor: "handler",
      visibility: "summary",
      title: "Inspect workflow outputs",
      summary: "Inspect the final workflow artifacts before emitting the episode.",
      facts: {
        outputCount: 2,
      },
    });
    store.finishCommand({
      commandId: reviewCommand.id,
      status: "succeeded",
      summary: "Inspection completed.",
    });

    store.updateThread({
      threadId: handlerThread.id,
      status: "completed",
    });
    const episode = store.createEpisode({
      threadId: handlerThread.id,
      sourceCommandId: reviewCommand.id,
      kind: "workflow",
      title: "Handler episode",
      summary: "Delegated objective completed.",
      body: "The handler thread finished after supervising two workflow runs.",
    });
    store.finishTurn({
      turnId: handlerTurn.id,
      status: "completed",
    });

    const snapshot = store.getSessionState("session-model");
    const detail = store.getThreadDetail(handlerThread.id);

    expect(snapshot.session).toEqual({
      id: "session-model",
      orchestratorPiSessionId: "session-model",
      pinnedAt: null,
      archivedAt: null,
      unreadAt: null,
      unreadReason: null,
      lastReadAt: null,
      wait: null,
    });
    expect(snapshot.turns).toEqual([
      expect.objectContaining({
        id: orchestratorTurn.id,
        surfacePiSessionId: "session-model",
        threadId: null,
        status: "completed",
      }),
      expect.objectContaining({
        id: handlerTurn.id,
        surfacePiSessionId: "pi-thread-001",
        threadId: handlerThread.id,
        status: "completed",
      }),
    ]);
    expect(snapshot.threads).toEqual([
      expect.objectContaining({
        id: handlerThread.id,
        surfacePiSessionId: "pi-thread-001",
        status: "completed",
      }),
    ]);
    expect("kind" in snapshot.threads[0]!).toBe(false);
    expect("dependsOnThreadIds" in snapshot.threads[0]!).toBe(false);

    expect(snapshot.commands).toContainEqual(
      expect.objectContaining({
        id: reviewCommand.id,
        surfacePiSessionId: "pi-thread-001",
        threadId: handlerThread.id,
        workflowRunId: runTwo.id,
        executor: "handler",
        facts: {
          outputCount: 2,
        },
      }),
    );
    expect((snapshot.workflowRuns ?? []).map((workflowRun) => workflowRun.id)).toEqual([
      runOne.id,
      runTwo.id,
    ]);
    expect(snapshot.episodes).toEqual([
      expect.objectContaining({
        id: episode.id,
        threadId: handlerThread.id,
        sourceCommandId: reviewCommand.id,
        summary: "Delegated objective completed.",
      }),
    ]);
    expect("artifactIds" in snapshot.episodes[0]!).toBe(false);
    expect(snapshot.artifacts).toEqual([
      expect.objectContaining({
        id: workflowArtifact.id,
        threadId: handlerThread.id,
        workflowRunId: runOne.id,
        sourceCommandId: startWorkflow.id,
      }),
    ]);
    expect("episodeId" in snapshot.artifacts[0]!).toBe(false);

    expect(detail.commands.map((entry) => entry.id)).toEqual([
      startWorkflow.id,
      resumeWorkflow.id,
      reviewCommand.id,
    ]);
    expect(detail.workflowRuns.map((entry) => entry.id)).toEqual([runOne.id, runTwo.id]);
    expect(detail.latestWorkflowRun?.id).toBe(runTwo.id);
    expect(detail.episodes.map((entry) => entry.id)).toEqual([episode.id]);
    expect(detail.artifacts.map((entry) => entry.id)).toEqual([workflowArtifact.id]);
    expect(snapshot.events.map((event) => event.kind)).toEqual([
      "turn.started",
      "thread.created",
      "turn.completed",
      "turn.started",
      "command.requested",
      "command.started",
      "command.finished",
      "workflowRun.created",
      "artifact.created",
      "thread.updated",
      "command.requested",
      "workflowRun.created",
      "command.requested",
      "command.finished",
      "thread.finished",
      "episode.created",
      "turn.completed",
    ]);
  });

  it("does not mutate terminal command records when finishCommand is called again", () => {
    const store = createStore();
    seedSession(store, "session-terminal-commands");
    const turn = store.startTurn({
      sessionId: "session-terminal-commands",
      surfacePiSessionId: "session-terminal-commands",
      requestSummary: "Run terminal command checks",
    });

    for (const status of ["succeeded", "failed", "cancelled"] as const) {
      const command = store.createCommand({
        turnId: turn.id,
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "summary",
        title: `Terminal ${status}`,
        summary: "Initial summary.",
      });
      store.finishCommand({
        commandId: command.id,
        status,
        summary: `Final ${status}.`,
        facts: { outcome: status, toolCallId: `tool-call-terminal-${status}` },
        error: status === "succeeded" ? null : `Initial ${status} error.`,
      });
      const first = store
        .getSessionState("session-terminal-commands")
        .commands.find((candidate) => candidate.id === command.id);
      expect(first).toMatchObject({
        status,
        summary: `Final ${status}.`,
        facts: { outcome: status, toolCallId: `tool-call-terminal-${status}` },
        error: status === "succeeded" ? null : `Initial ${status} error.`,
      });
      expect(first?.finishedAt).toBeTruthy();

      store.finishCommand({
        commandId: command.id,
        status: "cancelled",
        summary: "Prompt execution ended before the tool run finished.",
        facts: { overwritten: true },
        error: "Cleanup tried to cancel a finished command.",
      });
      store.updateCommandArguments(command.id, { overwritten: true });
      store.startCommand(command.id);
      store.createOrReuseStreamingCommand({
        toolCallId: `tool-call-terminal-${status}`,
        turnId: turn.id,
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "surface",
        title: "Late streamed title",
        summary: "Late streamed summary",
        arguments: { late: true },
        facts: { late: true },
      });

      const snapshot = store.getSessionState("session-terminal-commands");
      const second = snapshot.commands.find((candidate) => candidate.id === command.id);
      expect(second).toEqual(first);
      expect(
        snapshot.events.filter(
          (event) =>
            event.kind === "command.finished" &&
            event.subject.kind === "command" &&
            event.subject.id === command.id,
        ),
      ).toHaveLength(1);
    }
  });

  it("atomically terminalizes every durable fact owned by an interrupted turn", () => {
    const store = createStore();
    const sessionId = "session-interrupted-turn";
    const surfacePiSessionId = "surface-interrupted-turn";
    const streamGenerationId = "stream-interrupted-turn" as never;
    seedSession(store, sessionId);
    const queued = store.enqueueSurfaceMessage({
      sessionId,
      surfacePiSessionId,
      messageJson: JSON.stringify({ text: "Run interrupted work" }),
    });
    const claimed = store.claimNextQueuedSurfaceMessage({
      surfacePiSessionId,
      claimOwnerId: "owner-interrupted-turn",
      leaseDurationMs: 60_000,
    });
    expect(claimed?.id).toBe(queued.id);
    const turn = store.startTurn({
      sessionId,
      surfacePiSessionId,
      requestSummary: "Run interrupted work",
    });
    const user = store.commitRuntimeTranscriptUserMessage({
      workspaceSessionId: sessionId as never,
      surfacePiSessionId: surfacePiSessionId as never,
      turnId: turn.id as never,
      queueItemId: queued.id as never,
      message: { text: "Run interrupted work" },
      submittedAt: queued.createdAt as never,
      committedAt: "2026-04-18T09:00:20.000Z" as never,
      streamGenerationId,
      expectedCursor: null,
    });
    const assistant = store.beginRuntimeTranscriptAssistantMessage({
      workspaceSessionId: sessionId as never,
      surfacePiSessionId: surfacePiSessionId as never,
      turnId: turn.id as never,
      api: null,
      providerId: "openai" as never,
      modelId: "gpt-5.4" as never,
      startedAt: "2026-04-18T09:00:21.000Z" as never,
      streamGenerationId,
      expectedCursor: user.cursor,
    });
    const requestCommand = store.createCommand({
      turnId: turn.id,
      surfacePiSessionId,
      toolName: "request_user_input",
      executor: "orchestrator",
      visibility: "surface",
      title: "Ask user",
      summary: "Waiting for input.",
      status: "running",
    });
    const runningCommand = store.createCommand({
      turnId: turn.id,
      surfacePiSessionId,
      toolName: "exec_command",
      executor: "orchestrator",
      visibility: "surface",
      title: "Run command",
      summary: "Command is still running.",
      status: "running",
    });
    const request = store.createRequestUserInputRequest({
      sessionId,
      surfacePiSessionId,
      turnId: turn.id,
      commandId: requestCommand.id,
      toolItemId: "tool-interrupted-request",
      variant: "blocking",
      questions: [
        {
          title: "Continue",
          question: "Should the interrupted work continue?",
          defaultAnswer: { kind: "custom", text: "No." },
        },
      ],
    });
    const approval = store.createRuntimeApprovalRequest({
      sessionId,
      surfacePiSessionId,
      turnId: turn.id,
      commandId: runningCommand.id,
      toolCallId: "tool-interrupted-approval",
      toolName: "exec_command",
      approvalMode: "user",
      cwd: "/tmp/interrupted-turn",
      command: "sleep 60",
      commandFamily: "shell",
    });
    const recovered = store.recoverInterruptedTurn({
      turnId: turn.id,
      terminalStatus: "failed",
      reason: "Runtime process exited before terminal facts committed.",
    });

    expect(recovered).toEqual({
      changed: true,
      turn: expect.objectContaining({ id: turn.id, status: "failed" }),
      terminalizedAssistantMessageId: assistant.message.messageId,
      terminalizedCommandIds: [requestCommand.id, runningCommand.id],
      settledQueueItemId: queued.id,
      cancelledRequestInputIds: [request.requestId],
      cancelledApprovalIds: [approval.requestId],
      sessionWaitCleared: true,
    });
    const snapshot = store.getSessionState(sessionId);
    expect(snapshot.session.wait).toBeNull();
    expect(snapshot.commands.map((command) => [command.id, command.status])).toEqual([
      [requestCommand.id, "failed"],
      [runningCommand.id, "failed"],
    ]);
    expect(snapshot.queuedMessages).toContainEqual(
      expect.objectContaining({ id: queued.id, status: "failed" }),
    );
    expect(store.getRequestUserInputRequest(request.requestId).status).toBe("cancelled");
    expect(store.listOpenRuntimeApprovalRequests()).toEqual([]);
    expect(store.readRuntimeSurfaceTranscript(surfacePiSessionId)).toMatchObject({
      activeAssistantMessage: null,
      messages: [
        expect.objectContaining({ role: "user", queueItemId: queued.id }),
        expect.objectContaining({
          role: "assistant",
          messageId: assistant.message.messageId,
          status: "failed",
          stopReason: "error",
          errorMessage: "Runtime process exited before terminal facts committed.",
        }),
      ],
      streamCursor: expect.objectContaining({ streamSequence: 3 }),
    });

    const eventCount = snapshot.events.length;
    expect(
      store.recoverInterruptedTurn({
        turnId: turn.id,
        terminalStatus: "failed",
        reason: "Runtime process exited before terminal facts committed.",
      }),
    ).toEqual({
      changed: false,
      turn: expect.objectContaining({ id: turn.id, status: "failed" }),
      terminalizedAssistantMessageId: null,
      terminalizedCommandIds: [],
      settledQueueItemId: null,
      cancelledRequestInputIds: [],
      cancelledApprovalIds: [],
      sessionWaitCleared: false,
    });
    expect(
      store
        .getSessionState(sessionId)
        .events.slice(eventCount)
        .map((event) => event.kind),
    ).toEqual([]);
  });

  it("keeps later turn queue claims and waits intact when old recovery is retried", () => {
    const store = createStore();
    const sessionId = "session-interrupted-turn-retry";
    const surfacePiSessionId = "surface-interrupted-turn-retry";
    seedSession(store, sessionId);

    const oldQueued = store.enqueueSurfaceMessage({
      sessionId,
      surfacePiSessionId,
      messageJson: JSON.stringify({ text: "Old work" }),
    });
    expect(
      store.claimNextQueuedSurfaceMessage({
        surfacePiSessionId,
        claimOwnerId: "owner-old-interrupted-turn",
      })?.id,
    ).toBe(oldQueued.id);
    const oldTurn = store.startTurn({
      sessionId,
      surfacePiSessionId,
      requestSummary: "Old work",
    });
    expect(
      store.recoverInterruptedTurn({
        turnId: oldTurn.id,
        terminalStatus: "failed",
        reason: "Old runtime owner exited.",
      }).settledQueueItemId,
    ).toBe(oldQueued.id);

    const newQueued = store.enqueueSurfaceMessage({
      sessionId,
      surfacePiSessionId,
      messageJson: JSON.stringify({ text: "New work" }),
    });
    expect(
      store.claimNextQueuedSurfaceMessage({
        surfacePiSessionId,
        claimOwnerId: "owner-new-interrupted-turn",
      })?.id,
    ).toBe(newQueued.id);
    const newTurn = store.startTurn({
      sessionId,
      surfacePiSessionId,
      requestSummary: "New work",
    });
    store.setSessionWait({
      sessionId,
      owner: { kind: "orchestrator" },
      kind: "user",
      reason: "Waiting for new work input",
      resumeWhen: "Resume the new turn after input arrives.",
    });

    expect(
      store.recoverInterruptedTurn({
        turnId: oldTurn.id,
        terminalStatus: "failed",
        reason: "Delayed retry for the old runtime owner.",
      }),
    ).toEqual({
      changed: false,
      turn: expect.objectContaining({ id: oldTurn.id, status: "failed" }),
      terminalizedAssistantMessageId: null,
      terminalizedCommandIds: [],
      settledQueueItemId: null,
      cancelledRequestInputIds: [],
      cancelledApprovalIds: [],
      sessionWaitCleared: false,
    });
    expect(store.getSurfaceQueuedMessage({ id: newQueued.id }).status).toBe("dispatching");
    expect(store.getSessionState(sessionId).session.wait).toEqual(
      expect.objectContaining({
        owner: { kind: "orchestrator" },
        reason: "Waiting for new work input",
      }),
    );
    expect(store.getSessionState(sessionId).turns).toContainEqual(
      expect.objectContaining({ id: newTurn.id, status: "running" }),
    );
  });

  it("atomically settles a prompt turn, its queue claim, and dangling commands", () => {
    const store = createStore();
    const sessionId = "session-prompt-settlement";
    const surfacePiSessionId = "surface-prompt-settlement";
    seedSession(store, sessionId);
    const queued = store.enqueueSurfaceMessage({
      sessionId,
      surfacePiSessionId,
      messageJson: JSON.stringify({ text: "Finish atomically" }),
    });
    const claimed = store.claimNextQueuedSurfaceMessage({
      surfacePiSessionId,
      claimOwnerId: "owner-prompt-settlement",
      leaseDurationMs: 60_000,
    });
    expect(claimed?.id).toBe(queued.id);
    const turn = store.startTurn({
      sessionId,
      surfacePiSessionId,
      requestSummary: "Finish atomically",
    });
    const command = store.createCommand({
      turnId: turn.id,
      surfacePiSessionId,
      toolName: "exec_command",
      executor: "orchestrator",
      visibility: "surface",
      title: "Run command",
      summary: "Still running.",
      status: "running",
    });

    const settled = store.settlePromptTurn({
      turnId: turn.id,
      queueItemId: queued.id,
      status: "cancelled",
      assistantText: "Partial answer",
      terminalCommandIds: [command.id],
      terminalCommandSummary: "Prompt execution was cancelled.",
      terminalCommandError: "Prompt execution was cancelled.",
      claimOwnerId: claimed!.claimOwnerId,
      leaseVersion: claimed!.leaseVersion,
    });

    expect(settled).toEqual({
      changed: true,
      turn: expect.objectContaining({
        id: turn.id,
        status: "cancelled",
        assistantText: "Partial answer",
      }),
      queuedMessage: expect.objectContaining({ id: queued.id, status: "cancelled" }),
      terminalizedCommandIds: [command.id],
    });
    expect(store.getSessionState(sessionId)).toMatchObject({
      turns: [expect.objectContaining({ id: turn.id, status: "cancelled" })],
      queuedMessages: [expect.objectContaining({ id: queued.id, status: "cancelled" })],
      commands: [expect.objectContaining({ id: command.id, status: "cancelled" })],
    });

    expect(
      store.settlePromptTurn({
        turnId: turn.id,
        queueItemId: queued.id,
        status: "cancelled",
        assistantText: "Partial answer",
        terminalCommandIds: [command.id],
        terminalCommandSummary: "Prompt execution was cancelled.",
        terminalCommandError: "Prompt execution was cancelled.",
        claimOwnerId: claimed!.claimOwnerId,
        leaseVersion: claimed!.leaseVersion,
      }),
    ).toEqual({
      changed: false,
      turn: expect.objectContaining({ id: turn.id, status: "cancelled" }),
      queuedMessage: expect.objectContaining({ id: queued.id, status: "cancelled" }),
      terminalizedCommandIds: [],
    });
  });

  it("rolls prompt settlement back when any requested command belongs to another turn", () => {
    const store = createStore();
    const sessionId = "session-prompt-settlement-rollback";
    const surfacePiSessionId = "surface-prompt-settlement-rollback";
    seedSession(store, sessionId);
    const queued = store.enqueueSurfaceMessage({
      sessionId,
      surfacePiSessionId,
      messageJson: JSON.stringify({ text: "Do not partially settle" }),
    });
    const claimed = store.claimNextQueuedSurfaceMessage({
      surfacePiSessionId,
      claimOwnerId: "owner-prompt-settlement-rollback",
    });
    const turn = store.startTurn({
      sessionId,
      surfacePiSessionId,
      requestSummary: "Do not partially settle",
    });
    const otherTurn = store.startTurn({
      sessionId,
      surfacePiSessionId: "surface-other-prompt-settlement",
      requestSummary: "Other work",
    });
    const otherCommand = store.createCommand({
      turnId: otherTurn.id,
      surfacePiSessionId: "surface-other-prompt-settlement",
      toolName: "exec_command",
      executor: "orchestrator",
      visibility: "surface",
      title: "Other command",
      summary: "Still running.",
      status: "running",
    });

    expect(() =>
      store.settlePromptTurn({
        turnId: turn.id,
        queueItemId: queued.id,
        status: "failed",
        terminalCommandIds: [otherCommand.id],
        terminalCommandSummary: "Prompt failed.",
        terminalCommandError: "Prompt failed.",
        claimOwnerId: claimed!.claimOwnerId,
        leaseVersion: claimed!.leaseVersion,
      }),
    ).toThrow(`Command ${otherCommand.id} does not belong to turn ${turn.id}.`);
    expect(store.getSurfaceQueuedMessage({ id: queued.id }).status).toBe("dispatching");
    expect(store.getSessionState(sessionId).turns).toContainEqual(
      expect.objectContaining({ id: turn.id, status: "running" }),
    );
    expect(store.getSessionState(sessionId).commands).toContainEqual(
      expect.objectContaining({ id: otherCommand.id, status: "running" }),
    );
  });

  it("finishes a dispatching queue claim when the matching turn is already terminal", () => {
    const store = createStore();
    const sessionId = "session-prompt-settlement-crash-gap";
    const surfacePiSessionId = "surface-prompt-settlement-crash-gap";
    seedSession(store, sessionId);
    const queued = store.enqueueSurfaceMessage({
      sessionId,
      surfacePiSessionId,
      messageJson: JSON.stringify({ text: "Close the crash gap" }),
    });
    const claimed = store.claimNextQueuedSurfaceMessage({
      surfacePiSessionId,
      claimOwnerId: "owner-prompt-settlement-crash-gap",
    });
    const turn = store.startTurn({
      sessionId,
      surfacePiSessionId,
      requestSummary: "Close the crash gap",
    });
    store.finishTurn({ turnId: turn.id, status: "completed", assistantText: "Done." });

    expect(
      store.settlePromptTurn({
        turnId: turn.id,
        queueItemId: queued.id,
        status: "completed",
        assistantText: "Done.",
        terminalCommandIds: [],
        terminalCommandSummary: "Prompt finished.",
        terminalCommandError: "Prompt finished.",
        claimOwnerId: claimed!.claimOwnerId,
        leaseVersion: claimed!.leaseVersion,
      }),
    ).toEqual({
      changed: true,
      turn: expect.objectContaining({ id: turn.id, status: "completed" }),
      queuedMessage: expect.objectContaining({ id: queued.id, status: "delivered" }),
      terminalizedCommandIds: [],
    });
  });

  it("records ordered update and conclusion episodes per thread", () => {
    const store = createStore();
    seedSession(store, "session-episodes");

    const turn = store.startTurn({
      sessionId: "session-episodes",
      surfacePiSessionId: "session-episodes",
      requestSummary: "Complete a delegated thread",
    });
    const thread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-episodes",
      title: "Episode thread",
      objective: "Emit exactly one final episode.",
    });
    const handlerTurn = store.startTurn({
      sessionId: "session-episodes",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      requestSummary: "Prepare the final handler episode",
    });
    const command = store.createCommand({
      turnId: handlerTurn.id,
      threadId: thread.id,
      toolName: "execute_typescript",
      executor: "handler",
      visibility: "summary",
      title: "Draft episode",
      summary: "Prepare the final episode.",
    });

    const updateEpisode = store.createEpisode({
      threadId: thread.id,
      sourceCommandId: command.id,
      title: "Progress update",
      summary: "The thread is still running.",
      body: "The thread is still running.",
    });

    store.updateThread({
      threadId: thread.id,
      status: "completed",
    });
    const episode = store.createEpisode({
      threadId: thread.id,
      sourceCommandId: command.id,
      title: "Final episode",
      summary: "The thread completed.",
      body: "The thread completed.",
    });
    const secondEpisode = store.createEpisode({
      threadId: thread.id,
      title: "Follow-up episode",
      summary: "The thread returned control again.",
      body: "A later handoff should preserve the earlier handoff history.",
    });
    expect(episode.threadId).toBe(thread.id);
    expect(store.getThreadDetail(thread.id).episodes.map((entry) => entry.id)).toEqual([
      updateEpisode.id,
      episode.id,
      secondEpisode.id,
    ]);
  });

  it("keeps handler commands and artifacts separate from episodes until thread_report records one", () => {
    const store = createStore();
    seedSession(store, "session-episode-hygiene");

    const turn = store.startTurn({
      sessionId: "session-episode-hygiene",
      surfacePiSessionId: "session-episode-hygiene",
      requestSummary: "Delegate ordinary handler work",
    });
    const thread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-episode-hygiene",
      title: "Episode hygiene thread",
      objective: "Run ordinary handler work without reporting.",
    });
    const handlerTurn = store.startTurn({
      sessionId: "session-episode-hygiene",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      requestSummary: "Run ordinary handler command and artifact work",
    });
    const command = store.createCommand({
      turnId: handlerTurn.id,
      threadId: thread.id,
      toolName: "exec_command",
      executor: "handler",
      visibility: "surface",
      title: "Ordinary handler command",
      summary: "Command summary stays command-owned.",
    });
    store.finishCommand({
      commandId: command.id,
      status: "succeeded",
      summary: "Command summary stays command-owned.",
    });
    const artifact = store.createArtifact({
      threadId: thread.id,
      sourceCommandId: command.id,
      kind: "text",
      name: "ordinary-handler-note.txt",
      content: "Artifact content stays artifact-owned.",
      mimeType: "text/plain",
    });

    const snapshot = store.getSessionState("session-episode-hygiene");
    expect(snapshot.commands.map((entry) => entry.id)).toContain(command.id);
    expect(snapshot.artifacts.map((entry) => entry.id)).toContain(artifact.id);
    expect(snapshot.episodes).toEqual([]);
    expect(store.getThreadDetail(thread.id).episodes).toEqual([]);
  });

  it("keeps handler objective state separate from activity, waits, and Smithers runtime state", () => {
    const store = createStore();
    seedSession(store, "session-objective-state");

    const turn = store.startTurn({
      sessionId: "session-objective-state",
      surfacePiSessionId: "session-objective-state",
      requestSummary: "Delegate objective-state work",
    });
    const thread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-objective-state",
      title: "Objective State",
      objective: "Repair a workflow locally without concluding the delegated objective.",
    });
    const handlerTurn = store.startTurn({
      sessionId: "session-objective-state",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      requestSummary: "Run workflow and repair locally",
    });
    const command = store.createCommand({
      turnId: handlerTurn.id,
      threadId: thread.id,
      toolName: "exec_command",
      executor: "handler",
      visibility: "surface",
      title: "Run Smithers CLI",
      summary: "Start a workflow through Shell.",
    });
    const workflowRun = store.recordWorkflow({
      threadId: thread.id,
      commandId: command.id,
      smithersRunId: "smithers-run-objective-state",
      workflowName: "objective_state_workflow",
      workflowSource: "saved",
      status: "waiting",
      smithersStatus: "awaiting-approval",
      waitKind: "approval",
      summary: "Workflow is waiting on approval.",
    });
    store.upsertWorkflowTaskAttempt({
      workflowRunId: workflowRun.id,
      smithersRunId: workflowRun.smithersRunId,
      nodeId: "repair",
      iteration: 0,
      attempt: 1,
      summary: "Task needs local repair.",
      kind: "agent",
      status: "failed",
      smithersState: "failed",
      error: "The workflow task failed and needs repair.",
    });
    store.finishCommand({
      commandId: command.id,
      status: "failed",
      summary: "Smithers CLI failed and needs handler-local repair.",
      error: "The workflow task failed and needs repair.",
    });
    expect(store.getSessionState("session-objective-state")).toMatchObject({
      episodes: [],
      queuedMessages: [],
    });

    const wait = {
      owner: "workflow" as const,
      kind: "approval" as const,
      reason: "Smithers approval is pending",
      resumeWhen: "Resume after the approval is accepted.",
      since: "2026-04-18T09:00:03.000Z",
    };
    store.updateThread({
      threadId: thread.id,
      status: "waiting",
      wait,
    });
    expect(store.getThreadDetail(thread.id)).toMatchObject({
      thread: {
        objectiveState: "active",
        status: "waiting",
        wait,
      },
      latestWorkflowRun: expect.objectContaining({
        id: workflowRun.id,
        status: "waiting",
        smithersStatus: "awaiting-approval",
        waitKind: "approval",
      }),
      workflowTaskAttempts: [
        expect.objectContaining({
          nodeId: "repair",
          status: "failed",
          smithersState: "failed",
        }),
      ],
    });
    expect(store.getSessionState("session-objective-state")).toMatchObject({
      episodes: [],
      queuedMessages: [],
    });

    store.updateThread({
      threadId: thread.id,
      status: "troubleshooting",
      wait: null,
    });
    expect(store.getThreadDetail(thread.id)).toMatchObject({
      thread: {
        objectiveState: "active",
        status: "troubleshooting",
        wait: null,
      },
    });
    expect(store.getSessionState("session-objective-state")).toMatchObject({
      episodes: [],
      queuedMessages: [],
    });

    store.updateWorkflow({
      workflowId: workflowRun.id,
      status: "completed",
      smithersStatus: "completed",
      waitKind: null,
      summary: "Workflow repaired locally.",
    });
    expect(store.getThreadDetail(thread.id)).toMatchObject({
      thread: {
        objectiveState: "active",
      },
      latestWorkflowRun: expect.objectContaining({
        id: workflowRun.id,
        status: "completed",
        smithersStatus: "completed",
        waitKind: null,
      }),
    });
    expect(store.getSessionState("session-objective-state")).toMatchObject({
      episodes: [],
      queuedMessages: [],
    });

    store.updateThread({
      threadId: thread.id,
      objectiveState: "concluded",
      status: "completed",
    });
    expect(store.getThreadDetail(thread.id)).toMatchObject({
      thread: {
        objectiveState: "concluded",
        status: "completed",
      },
    });
  });

  it("tracks thread-owned session wait and clears it when runnable work exists again", () => {
    const store = createStore();
    seedSession(store, "session-thread-wait");

    const turn = store.startTurn({
      sessionId: "session-thread-wait",
      surfacePiSessionId: "session-thread-wait",
      requestSummary: "Pause a handler thread",
    });
    const waitingThread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-wait",
      title: "Need clarification",
      objective: "Pause until the user answers.",
    });
    const wait = {
      owner: "handler" as const,
      kind: "user" as const,
      reason: "Need clarification on rollout scope",
      resumeWhen: "Resume when the user confirms the rollout scope.",
      since: "2026-04-18T09:00:03.000Z",
    };
    store.updateThread({
      threadId: waitingThread.id,
      status: "waiting",
      wait,
    });
    const sessionWait = store.setSessionWait({
      sessionId: "session-thread-wait",
      owner: { kind: "thread", threadId: waitingThread.id },
      kind: wait.kind,
      reason: wait.reason,
      resumeWhen: wait.resumeWhen,
    });

    expect(sessionWait).toEqual({
      owner: { kind: "thread", threadId: waitingThread.id },
      kind: wait.kind,
      reason: wait.reason,
      resumeWhen: wait.resumeWhen,
      since: expect.any(String),
    });

    const runnableThread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-runnable",
      title: "Parallel implementation",
      objective: "Continue independent runnable work.",
    });
    const snapshot = store.getSessionState("session-thread-wait");

    expect(runnableThread.status).toBe("running-handler");
    expect(snapshot.session.wait).toBeNull();
    expect(snapshot.threads.find((thread) => thread.id === waitingThread.id)?.wait).toEqual(wait);
  });

  it("supports orchestrator-owned session wait and clears it when a handler thread starts", () => {
    const store = createStore();
    seedSession(store, "session-orchestrator-wait");

    const turn = store.startTurn({
      sessionId: "session-orchestrator-wait",
      surfacePiSessionId: "session-orchestrator-wait",
      requestSummary: "Wait at the orchestrator level",
    });
    const waitingOn = store.setSessionWait({
      sessionId: "session-orchestrator-wait",
      owner: { kind: "orchestrator" },
      kind: "user",
      reason: "Need the user to choose the execution mode",
      resumeWhen: "Resume when the user chooses the execution mode.",
    });

    expect(waitingOn).toEqual({
      owner: { kind: "orchestrator" },
      kind: "user",
      reason: "Need the user to choose the execution mode",
      resumeWhen: "Resume when the user chooses the execution mode.",
      since: expect.any(String),
    });

    store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-handler",
      title: "Resume work",
      objective: "Resume with a runnable handler thread.",
    });

    expect(store.getSessionState("session-orchestrator-wait").session.wait).toBeNull();
  });

  it("claims queued surface messages atomically and keeps dispatching rows visible", () => {
    const store = createStore();
    seedSession(store, "session-queue-claim");

    const first = store.enqueueSurfaceMessage({
      sessionId: "session-queue-claim",
      surfacePiSessionId: "surface-queue-claim",
      messageJson: JSON.stringify({ role: "user", content: "First queued prompt" }),
      orderingKey: "surface:surface-queue-claim",
    });
    const second = store.enqueueSurfaceMessage({
      sessionId: "session-queue-claim",
      surfacePiSessionId: "surface-queue-claim",
      messageJson: JSON.stringify({ role: "user", content: "Second queued prompt" }),
    });

    expect(
      store
        .listQueuedSurfaceMessages({ surfacePiSessionId: "surface-queue-claim" })
        .map((message) => [message.id, message.status]),
    ).toEqual([
      [first.id, "queued"],
      [second.id, "queued"],
    ]);

    const claimed = store.claimNextQueuedSurfaceMessage({
      surfacePiSessionId: "surface-queue-claim",
      claimOwnerId: "runtime-worker-a",
      leaseDurationMs: 15_000,
    });
    expect(claimed).toMatchObject({
      id: first.id,
      status: "dispatching",
      priority: "runtime",
      orderingKey: "surface:surface-queue-claim",
      sequence: 1,
      claimOwnerId: "runtime-worker-a",
      claimLeaseExpiresAt: "2026-04-18T09:00:17.000Z",
      leaseVersion: 1,
      attemptCount: 1,
      maxAttempts: 3,
    });
    const nextClaim = store.claimNextQueuedSurfaceMessage({
      surfacePiSessionId: "surface-queue-claim",
    });
    expect(nextClaim).toMatchObject({
      id: second.id,
      status: "dispatching",
      claimOwnerId: "runtime",
      leaseVersion: 1,
      attemptCount: 1,
    });
    expect(
      store.claimNextQueuedSurfaceMessage({ surfacePiSessionId: "surface-queue-claim" }),
    ).toBeNull();
    expect(
      store
        .listQueuedSurfaceMessages({ surfacePiSessionId: "surface-queue-claim" })
        .map((message) => [message.id, message.status]),
    ).toEqual([
      [first.id, "dispatching"],
      [second.id, "dispatching"],
    ]);

    expect(() =>
      store.markSurfaceMessageDelivered({
        id: first.id,
        claimOwnerId: "runtime-worker-b",
        leaseVersion: claimed!.leaseVersion,
      }),
    ).toThrow("Surface queued message claim is stale");
    expect(() =>
      store.markSurfaceMessageDelivered({
        id: first.id,
        claimOwnerId: claimed!.claimOwnerId,
        leaseVersion: claimed!.leaseVersion + 1,
      }),
    ).toThrow("Surface queued message claim is stale");
    expect(store.getSurfaceQueuedMessage({ id: first.id })).toMatchObject({
      status: "dispatching",
      claimOwnerId: "runtime-worker-a",
      leaseVersion: 1,
    });

    store.markSurfaceMessageDelivered({
      id: first.id,
      claimOwnerId: claimed!.claimOwnerId,
      leaseVersion: claimed!.leaseVersion,
    });
    store.markSurfaceMessageQueued({ id: second.id, position: "front" });
    expect(store.getSurfaceQueuedMessage({ id: second.id })).toMatchObject({
      claimOwnerId: null,
      claimLeaseExpiresAt: null,
      attemptCount: 0,
    });
    expect(
      store
        .listQueuedSurfaceMessages({ surfacePiSessionId: "surface-queue-claim" })
        .map((message) => [message.id, message.status]),
    ).toEqual([[second.id, "queued"]]);
  });

  it("guards queued steering and cancellation against already-dispatching rows", () => {
    const store = createStore();
    seedSession(store, "session-queue-guard");
    const queued = store.enqueueSurfaceMessage({
      sessionId: "session-queue-guard",
      surfacePiSessionId: "surface-queue-guard",
      messageJson: JSON.stringify({ role: "user", content: "Guard this prompt" }),
    });

    const claimed = store.claimNextQueuedSurfaceMessage({
      surfacePiSessionId: "surface-queue-guard",
      claimOwnerId: "runtime-worker-guard",
      leaseDurationMs: 15_000,
    });

    expect(() =>
      store.markSurfaceMessageQueued({
        id: queued.id,
        position: "front",
        expectedStatuses: ["queued", "steering"],
      }),
    ).toThrow("Surface queued message");
    expect(() =>
      store.cancelSurfaceMessage({
        id: queued.id,
        expectedStatuses: ["queued", "steering"],
      }),
    ).toThrow("Surface queued message");
    expect(store.getSurfaceQueuedMessage({ id: queued.id })).toMatchObject({
      id: queued.id,
      status: "dispatching",
      claimOwnerId: "runtime-worker-guard",
      claimLeaseExpiresAt: "2026-04-18T09:00:16.000Z",
      leaseVersion: claimed!.leaseVersion,
    });

    store.markSurfaceMessageQueued({
      id: queued.id,
      position: "front",
      expectedStatuses: ["dispatching"],
    });
    expect(store.getSurfaceQueuedMessage({ id: queued.id })).toMatchObject({
      status: "queued",
      claimOwnerId: null,
      claimLeaseExpiresAt: null,
    });
    store.cancelSurfaceMessage({
      id: queued.id,
      expectedStatuses: ["queued", "steering"],
    });
    expect(store.getSurfaceQueuedMessage({ id: queued.id }).status).toBe("cancelled");
  });

  it("keeps failed queued messages visible and out of future claims until restored", () => {
    const store = createStore();
    seedSession(store, "session-queue-failure");
    const first = store.enqueueSurfaceMessage({
      sessionId: "session-queue-failure",
      surfacePiSessionId: "surface-queue-failure",
      messageJson: JSON.stringify({ role: "user", content: "Malformed queued prompt" }),
    });
    const second = store.enqueueSurfaceMessage({
      sessionId: "session-queue-failure",
      surfacePiSessionId: "surface-queue-failure",
      messageJson: JSON.stringify({ role: "user", content: "Next queued prompt" }),
    });

    expect(
      store.claimNextQueuedSurfaceMessage({ surfacePiSessionId: "surface-queue-failure" })?.id,
    ).toBe(first.id);
    const failed = store.markSurfaceMessageFailed({
      id: first.id,
      failureError: "Queued surface message could not be parsed.",
    });

    expect(failed).toMatchObject({
      id: first.id,
      status: "failed",
      failureError: "Queued surface message could not be parsed.",
      failedAt: expect.any(String),
    });
    expect(
      store.claimNextQueuedSurfaceMessage({ surfacePiSessionId: "surface-queue-failure" })?.id,
    ).toBe(second.id);
    expect(
      store
        .listQueuedSurfaceMessages({ surfacePiSessionId: "surface-queue-failure" })
        .map((message) => [message.id, message.status, message.failureError]),
    ).toEqual([
      [second.id, "dispatching", null],
      [first.id, "failed", "Queued surface message could not be parsed."],
    ]);

    const restored = store.markSurfaceMessageQueued({ id: first.id, position: "front" });
    expect(restored).toMatchObject({
      status: "queued",
      failedAt: null,
      failureError: null,
    });
  });

  it("claims steering rows first, then persisted priority, then FIFO sequence", () => {
    const store = createStore();
    seedSession(store, "session-queue-priority");

    const background = store.enqueueSurfaceMessage({
      sessionId: "session-queue-priority",
      surfacePiSessionId: "surface-queue-priority",
      priority: "background",
      messageJson: JSON.stringify({ role: "user", content: "Background queued prompt" }),
    });
    const runtime = store.enqueueSurfaceMessage({
      sessionId: "session-queue-priority",
      surfacePiSessionId: "surface-queue-priority",
      priority: "runtime",
      messageJson: JSON.stringify({ role: "user", content: "Runtime queued prompt" }),
    });
    const interactive = store.enqueueSurfaceMessage({
      sessionId: "session-queue-priority",
      surfacePiSessionId: "surface-queue-priority",
      priority: "interactive",
      messageJson: JSON.stringify({ role: "user", content: "Interactive queued prompt" }),
    });
    const steered = store.enqueueSurfaceMessage({
      sessionId: "session-queue-priority",
      surfacePiSessionId: "surface-queue-priority",
      priority: "background",
      messageJson: JSON.stringify({ role: "user", content: "Steered queued prompt" }),
    });
    store.markSurfaceMessageSteering({ id: steered.id });

    expect(
      store.claimNextQueuedSurfaceMessage({ surfacePiSessionId: "surface-queue-priority" })?.id,
    ).toBe(steered.id);
    expect(
      store.claimNextQueuedSurfaceMessage({ surfacePiSessionId: "surface-queue-priority" })?.id,
    ).toBe(interactive.id);
    expect(
      store.claimNextQueuedSurfaceMessage({ surfacePiSessionId: "surface-queue-priority" })?.id,
    ).toBe(runtime.id);
    expect(
      store.claimNextQueuedSurfaceMessage({ surfacePiSessionId: "surface-queue-priority" })?.id,
    ).toBe(background.id);
  });

  it("releases expired queue claims back to queued state without resetting attempts", () => {
    const store = createStore();
    seedSession(store, "session-queue-expired-claim");
    const queued = store.enqueueSurfaceMessage({
      sessionId: "session-queue-expired-claim",
      surfacePiSessionId: "surface-queue-expired-claim",
      messageJson: JSON.stringify({ role: "user", content: "Lease expires" }),
    });

    const claimed = store.claimNextQueuedSurfaceMessage({
      surfacePiSessionId: "surface-queue-expired-claim",
      claimOwnerId: "runtime-worker-expiring",
      leaseDurationMs: 1_000,
    });
    expect(claimed).toMatchObject({
      id: queued.id,
      status: "dispatching",
      claimOwnerId: "runtime-worker-expiring",
      attemptCount: 1,
      leaseVersion: 1,
    });

    expect(
      store.releaseExpiredSurfaceMessageClaims({
        surfacePiSessionId: "surface-queue-expired-claim",
        now: "2026-04-18T09:00:03.000Z",
      }),
    ).toEqual([
      expect.objectContaining({
        id: queued.id,
        status: "queued",
        claimOwnerId: null,
        claimLeaseExpiresAt: null,
        attemptCount: 1,
        leaseVersion: 1,
      }),
    ]);
    const reclaimed = store.claimNextQueuedSurfaceMessage({
      surfacePiSessionId: "surface-queue-expired-claim",
      claimOwnerId: "runtime-worker-reclaiming",
    });
    expect(reclaimed).toMatchObject({
      id: queued.id,
      status: "dispatching",
      claimOwnerId: "runtime-worker-reclaiming",
      attemptCount: 2,
      leaseVersion: 2,
    });

    const restored = store.markSurfaceMessageQueued({ id: queued.id });
    expect(restored).toMatchObject({ attemptCount: 0 });
    expect(
      store.claimNextQueuedSurfaceMessage({ surfacePiSessionId: "surface-queue-expired-claim" })
        ?.id,
    ).toBe(queued.id);
  });

  it("rejects stale dispatch requeue after an expired lease is reclaimed", () => {
    const store = createStore();
    seedSession(store, "session-queue-stale-requeue");
    const queued = store.enqueueSurfaceMessage({
      sessionId: "session-queue-stale-requeue",
      surfacePiSessionId: "surface-queue-stale-requeue",
      messageJson: JSON.stringify({ role: "user", content: "Lease may be stolen" }),
    });

    const staleClaim = store.claimNextQueuedSurfaceMessage({
      surfacePiSessionId: "surface-queue-stale-requeue",
      claimOwnerId: "runtime-worker-stale",
      leaseDurationMs: 1_000,
    });
    store.releaseExpiredSurfaceMessageClaims({
      surfacePiSessionId: "surface-queue-stale-requeue",
      now: "2026-04-18T09:00:03.000Z",
    });
    const currentClaim = store.claimNextQueuedSurfaceMessage({
      surfacePiSessionId: "surface-queue-stale-requeue",
      claimOwnerId: "runtime-worker-current",
      leaseDurationMs: 15_000,
    });

    expect(() =>
      store.markSurfaceMessageQueued({
        id: queued.id,
        position: "front",
        claimOwnerId: staleClaim!.claimOwnerId,
        leaseVersion: staleClaim!.leaseVersion,
        expectedStatuses: ["dispatching"],
      }),
    ).toThrow("Surface queued message");
    expect(store.getSurfaceQueuedMessage({ id: queued.id })).toMatchObject({
      id: queued.id,
      status: "dispatching",
      claimOwnerId: "runtime-worker-current",
      leaseVersion: currentClaim!.leaseVersion,
    });
  });

  it("persists request_user_input answers as highest-priority same-surface queue work", () => {
    const store = createStore();
    seedSession(store, "session-rui-answer");
    const turn = store.startTurn({
      sessionId: "session-rui-answer",
      surfacePiSessionId: "session-rui-answer",
      requestSummary: "Ask for local clarification",
    });
    const thread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-rui-answer",
      title: "Clarify locally",
      objective: "Use handler-local clarification.",
    });
    const handlerTurn = store.startTurn({
      sessionId: "session-rui-answer",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      requestSummary: "Ask for handler-local clarification",
    });
    const command = store.createCommand({
      turnId: handlerTurn.id,
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      toolName: "request_user_input",
      executor: "handler",
      visibility: "surface",
      title: "Ask user",
      summary: "Clarify the repair direction.",
    });
    const request = store.createRequestUserInputRequest({
      sessionId: "session-rui-answer",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      turnId: handlerTurn.id,
      commandId: command.id,
      toolItemId: "tool-call-rui-answer",
      variant: "nonblocking",
      questions: [
        {
          title: "Repair direction",
          question: "Should I repair locally or report back now?",
          defaultAnswer: {
            kind: "option",
            label: "Repair locally",
            text: "Repair locally",
          },
          choices: [
            {
              label: "Repair locally",
              description: "Keeps ownership inside this handler thread.",
              recommended: true,
            },
            {
              label: "Report back",
              description: "Returns control to the orchestrator.",
              recommended: false,
            },
          ],
        },
      ],
    });
    const question = request.questions[0]!;
    const reportBack = question.choices.find((choice) => choice.label === "Report back")!;
    const ordinary = store.enqueueSurfaceMessage({
      sessionId: "session-rui-answer",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      messageJson: JSON.stringify({ role: "user", content: "Ordinary follow-up" }),
    });
    const answered = store.answerRequestUserInput({
      surfacePiSessionId: thread.surfacePiSessionId,
      requestId: request.requestId,
      questionId: question.questionId,
      answer: { kind: "option", optionId: reportBack.optionId },
      delivery: "enqueue-and-run",
    });
    expect(answered.queuedMessage).not.toBeNull();

    expect(answered.request).toMatchObject({
      requestId: request.requestId,
      status: "completed",
      completedAt: "2026-04-18T09:00:06.000Z",
    });
    expect(answered.answer).toMatchObject({
      answeredBy: "user",
      delivery: "enqueue-and-run",
      queuedItemId: answered.queuedMessage!.id,
      answer: {
        kind: "option",
        label: "Report back",
        text: "Report back",
      },
    });
    expect(answered.queuedMessage).toMatchObject({
      sessionId: "session-rui-answer",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      kind: "request_user_input_answer",
      status: "steering",
      priority: "interactive",
      orderingKey: `surface:${thread.surfacePiSessionId}`,
    });
    expect(JSON.parse(answered.queuedMessage!.payloadJson!)).toEqual({
      kind: "request_user_input_answer",
      requestId: request.requestId,
      questionId: question.questionId,
      answerId: answered.answer.answerId,
      delivery: "enqueue-and-run",
    });
    expect(JSON.parse(answered.queuedMessage!.messageJson)).toEqual({
      type: "request_user_input.answer",
      title: "Repair direction",
      question: "Should I repair locally or report back now?",
      originalAnswer: {
        kind: "option",
        label: "Repair locally",
        text: "Repair locally",
      },
      userAnswer: {
        kind: "option",
        label: "Report back",
        text: "Report back",
      },
    });

    expect(
      store.claimNextQueuedSurfaceMessage({ surfacePiSessionId: thread.surfacePiSessionId })?.id,
    ).toBe(answered.queuedMessage!.id);
    expect(
      store.claimNextQueuedSurfaceMessage({ surfacePiSessionId: thread.surfacePiSessionId })?.id,
    ).toBe(ordinary.id);
  });

  it("preserves FIFO order within request_user_input answer queue work", () => {
    const store = createStore();
    seedSession(store, "session-rui-fifo");
    const turn = store.startTurn({
      sessionId: "session-rui-fifo",
      surfacePiSessionId: "session-rui-fifo",
      requestSummary: "Ask multiple clarifications",
    });
    const command = store.createCommand({
      turnId: turn.id,
      surfacePiSessionId: "session-rui-fifo",
      toolName: "request_user_input",
      executor: "orchestrator",
      visibility: "surface",
      title: "Ask user",
      summary: "Clarify two details.",
    });
    const request = store.createRequestUserInputRequest({
      sessionId: "session-rui-fifo",
      surfacePiSessionId: "session-rui-fifo",
      turnId: turn.id,
      commandId: command.id,
      toolItemId: "tool-call-rui-fifo",
      variant: "nonblocking",
      questions: [
        {
          title: "First detail",
          question: "What should happen first?",
          defaultAnswer: { kind: "custom", text: "Use the first default." },
        },
        {
          title: "Second detail",
          question: "What should happen second?",
          defaultAnswer: { kind: "custom", text: "Use the second default." },
        },
      ],
    });
    const ordinary = store.enqueueSurfaceMessage({
      sessionId: "session-rui-fifo",
      surfacePiSessionId: "session-rui-fifo",
      messageJson: JSON.stringify({ role: "user", content: "Ordinary follow-up" }),
    });

    const firstAnswer = store.answerRequestUserInput({
      surfacePiSessionId: "session-rui-fifo",
      requestId: request.requestId,
      questionId: request.questions[0]!.questionId,
      answer: { kind: "custom", text: "First answer" },
      delivery: "enqueue-and-run",
    });
    const secondAnswer = store.answerRequestUserInput({
      surfacePiSessionId: "session-rui-fifo",
      requestId: request.requestId,
      questionId: request.questions[1]!.questionId,
      answer: { kind: "custom", text: "Second answer" },
      delivery: "enqueue-and-run",
    });
    expect(firstAnswer.queuedMessage).not.toBeNull();
    expect(secondAnswer.queuedMessage).not.toBeNull();

    expect(
      store.claimNextQueuedSurfaceMessage({ surfacePiSessionId: "session-rui-fifo" })?.id,
    ).toBe(firstAnswer.queuedMessage!.id);
    expect(
      store.claimNextQueuedSurfaceMessage({ surfacePiSessionId: "session-rui-fifo" })?.id,
    ).toBe(secondAnswer.queuedMessage!.id);
    expect(
      store.claimNextQueuedSurfaceMessage({ surfacePiSessionId: "session-rui-fifo" })?.id,
    ).toBe(ordinary.id);
  });

  it("reopens request_user_input questions when a queued answer is cancelled", () => {
    const store = createStore();
    seedSession(store, "session-rui-cancel-answer");
    const turn = store.startTurn({
      sessionId: "session-rui-cancel-answer",
      surfacePiSessionId: "session-rui-cancel-answer",
      requestSummary: "Ask a clarification",
    });
    const command = store.createCommand({
      turnId: turn.id,
      surfacePiSessionId: "session-rui-cancel-answer",
      toolName: "request_user_input",
      executor: "orchestrator",
      visibility: "surface",
      title: "Ask user",
      summary: "Clarify one detail.",
    });
    const request = store.createRequestUserInputRequest({
      sessionId: "session-rui-cancel-answer",
      surfacePiSessionId: "session-rui-cancel-answer",
      turnId: turn.id,
      commandId: command.id,
      toolItemId: "tool-call-rui-cancel-answer",
      variant: "nonblocking",
      questions: [
        {
          title: "CI scope",
          question: "Should CI run only unit checks or the full suite?",
          defaultAnswer: { kind: "custom", text: "Run unit checks." },
        },
      ],
    });

    const answered = store.answerRequestUserInput({
      surfacePiSessionId: "session-rui-cancel-answer",
      requestId: request.requestId,
      questionId: request.questions[0]!.questionId,
      answer: { kind: "custom", text: "Run the full suite." },
      delivery: "queue-only",
    });
    expect(answered.queuedMessage).not.toBeNull();
    expect(answered.request).toMatchObject({
      status: "completed",
      questions: [expect.objectContaining({ status: "answered" })],
    });

    store.cancelSurfaceMessage({ id: answered.queuedMessage!.id });

    const reopened = store.getRequestUserInputRequest(request.requestId);
    expect(reopened).toMatchObject({
      status: "open",
      completedAt: null,
      questions: [expect.objectContaining({ status: "open" })],
    });
    expect(
      reopened.answers.filter((answer) => answer.questionId === request.questions[0]!.questionId),
    ).toEqual([
      expect.objectContaining({
        answeredBy: "default",
        queuedItemId: null,
      }),
    ]);
    expect(store.getSurfaceQueuedMessage({ id: answered.queuedMessage!.id }).status).toBe(
      "cancelled",
    );
  });

  it("rejects invalid request_user_input answers without queueing work", () => {
    const store = createStore();
    seedSession(store, "session-rui-invalid");
    const turn = store.startTurn({
      sessionId: "session-rui-invalid",
      surfacePiSessionId: "session-rui-invalid",
      requestSummary: "Ask for clarification",
    });
    const command = store.createCommand({
      turnId: turn.id,
      surfacePiSessionId: "session-rui-invalid",
      toolName: "request_user_input",
      executor: "orchestrator",
      visibility: "surface",
      title: "Ask user",
      summary: "Clarify locally.",
    });
    const request = store.createRequestUserInputRequest({
      sessionId: "session-rui-invalid",
      surfacePiSessionId: "session-rui-invalid",
      turnId: turn.id,
      commandId: command.id,
      toolItemId: "tool-call-rui-invalid",
      variant: "nonblocking",
      questions: [
        {
          title: "Branch",
          question: "Which branch should I use?",
          defaultAnswer: { kind: "custom", text: "Use the current branch." },
        },
      ],
    });

    expect(() =>
      store.answerRequestUserInput({
        surfacePiSessionId: "other-surface",
        requestId: request.requestId,
        questionId: request.questions[0]!.questionId,
        answer: { kind: "custom", text: "Use feature/redesign." },
        delivery: "queue-only",
      }),
    ).toThrow("does not belong to the target surface");

    expect(() =>
      store.answerRequestUserInput({
        surfacePiSessionId: "session-rui-invalid",
        requestId: request.requestId,
        questionId: request.questions[0]!.questionId,
        answer: { kind: "custom", text: "   " },
        delivery: "queue-only",
      }),
    ).toThrow("custom answer cannot be blank");

    expect(store.listQueuedSurfaceMessages({ surfacePiSessionId: "session-rui-invalid" })).toEqual(
      [],
    );
  });

  it("persists request_user_input timer pause and resume state", () => {
    const store = createStore();
    seedSession(store, "session-rui-timer");
    const turn = store.startTurn({
      sessionId: "session-rui-timer",
      surfacePiSessionId: "session-rui-timer",
      requestSummary: "Ask before proceeding",
    });
    const command = store.createCommand({
      turnId: turn.id,
      surfacePiSessionId: "session-rui-timer",
      toolName: "request_user_input",
      executor: "orchestrator",
      visibility: "surface",
      title: "Ask user",
      summary: "Clarify the safe path.",
    });
    const request = store.createRequestUserInputRequest({
      sessionId: "session-rui-timer",
      surfacePiSessionId: "session-rui-timer",
      turnId: turn.id,
      commandId: command.id,
      toolItemId: "tool-call-rui-timer",
      variant: "blocking",
      timeout: {
        enabled: true,
        durationMs: 300_000,
      },
      questions: [
        {
          title: "Proceed",
          question: "Should I proceed now?",
          defaultAnswer: { kind: "custom", text: "Proceed with the safe default." },
        },
      ],
    });

    const paused = store.setRequestUserInputTimerPaused({
      surfacePiSessionId: "session-rui-timer",
      requestId: request.requestId,
      paused: true,
    });
    expect(paused.record.timeout).toMatchObject({
      timerVersion: 2,
      pausedAt: "2026-04-18T09:00:03.000Z",
      remainingMsWhenPaused: 299_000,
      expiresAt: null,
    });

    const resumed = store.setRequestUserInputTimerPaused({
      surfacePiSessionId: "session-rui-timer",
      requestId: request.requestId,
      paused: false,
    });
    expect(resumed.record.timeout).toMatchObject({
      timerVersion: 3,
      pausedAt: null,
      remainingMsWhenPaused: null,
      expiresAt: "2026-04-18T09:05:03.000Z",
    });
  });

  it("claims recovery work with idempotency keys, leases, and owner locks", () => {
    const store = createStore();
    const first = store.ensureRecoveryWork({
      scope: { kind: "workspace", workspaceId: store.workspaceId },
      kind: "queue_delivery",
      ownerScope: {
        kind: "surface",
        workspaceSessionId: "session-recovery",
        surfacePiSessionId: "surface-recovery",
      },
      idempotencyKey: "queue_delivery:surface-recovery",
      orderingKey: "surface:surface-recovery",
      orderingSeq: 0,
      priority: 30,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 3,
    });
    const duplicate = store.ensureRecoveryWork({
      scope: { kind: "workspace", workspaceId: store.workspaceId },
      kind: "queue_delivery",
      ownerScope: {
        kind: "surface",
        workspaceSessionId: "session-recovery",
        surfacePiSessionId: "surface-recovery",
      },
      idempotencyKey: "queue_delivery:surface-recovery",
      orderingKey: "surface:surface-recovery",
      orderingSeq: 0,
      priority: 30,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 3,
    });
    store.ensureRecoveryWork({
      scope: { kind: "workspace", workspaceId: store.workspaceId },
      kind: "active_turn_recovery",
      ownerScope: {
        kind: "surface",
        workspaceSessionId: "session-recovery",
        surfacePiSessionId: "surface-recovery",
      },
      idempotencyKey: "active_turn_recovery:surface-recovery:turn-1",
      orderingKey: "surface:surface-recovery",
      orderingSeq: -1,
      priority: 5,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 3,
    });

    expect(duplicate.id).toBe(first.id);
    const claimed = store.claimNextRecoveryWork({ claimedBy: "coordinator-a", leaseMs: 60_000 });
    expect(claimed).toMatchObject({
      kind: "active_turn_recovery",
      status: "claimed",
      attempts: 1,
      claimedBy: "coordinator-a",
    });
    expect(store.claimNextRecoveryWork({ claimedBy: "coordinator-b" })).toBeNull();

    expect(() =>
      store.completeRecoveryWork({
        id: claimed!.id,
        claimedBy: "coordinator-b",
        leaseVersion: claimed!.leaseVersion,
      }),
    ).toThrow("Recovery work claim is stale");
    expect(() =>
      store.completeRecoveryWork({
        id: claimed!.id,
        claimedBy: claimed!.claimedBy,
        leaseVersion: claimed!.leaseVersion + 1,
      }),
    ).toThrow("Recovery work claim is stale");

    store.completeRecoveryWork({
      id: claimed!.id,
      claimedBy: claimed!.claimedBy,
      leaseVersion: claimed!.leaseVersion,
    });
    expect(store.claimNextRecoveryWork({ claimedBy: "coordinator-b" })).toMatchObject({
      id: first.id,
      status: "claimed",
    });
  });

  it("preserves queue-delivery dirty-set wakes that arrive while a row is claimed", () => {
    const store = createStore();
    const first = store.ensureRecoveryWork({
      scope: { kind: "workspace", workspaceId: store.workspaceId },
      kind: "queue_delivery",
      ownerScope: {
        kind: "surface",
        workspaceSessionId: "session-recovery-dirty",
        surfacePiSessionId: "surface-recovery-dirty",
      },
      idempotencyKey: "queue_delivery:surface-recovery-dirty",
      orderingKey: "surface:surface-recovery-dirty",
      orderingSeq: 0,
      priority: 30,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 3,
    });
    const claimed = store.claimNextRecoveryWork({
      claimedBy: "coordinator-dirty",
      leaseMs: 60_000,
    });

    const redirty = store.ensureRecoveryWork({
      scope: { kind: "workspace", workspaceId: store.workspaceId },
      kind: "queue_delivery",
      ownerScope: {
        kind: "surface",
        workspaceSessionId: "session-recovery-dirty",
        surfacePiSessionId: "surface-recovery-dirty",
      },
      idempotencyKey: "queue_delivery:surface-recovery-dirty",
      orderingKey: "surface:surface-recovery-dirty",
      orderingSeq: 0,
      priority: 30,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 3,
    });

    expect(claimed?.id).toBe(first.id);
    expect(redirty.id).not.toBe(first.id);
    expect(redirty).toMatchObject({
      kind: "queue_delivery",
      status: "pending",
      idempotencyKey: "queue_delivery:surface-recovery-dirty",
    });

    store.completeRecoveryWork({
      id: claimed!.id,
      claimedBy: claimed!.claimedBy,
      leaseVersion: claimed!.leaseVersion,
    });
    expect(store.claimNextRecoveryWork({ claimedBy: "coordinator-dirty-followup" })).toMatchObject({
      id: redirty.id,
      status: "claimed",
    });
  });

  it("persists generated package refresh and title generation scheduler records", () => {
    const store = createStore();
    const workflowsRefresh = store.ensureRecoveryWork({
      scope: { kind: "app" },
      kind: "generated_package_refresh",
      ownerScope: { kind: "workspace" },
      idempotencyKey: "generated_package_refresh:workspace",
      orderingKey: "workspace:root",
      orderingSeq: 0,
      priority: 5,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 3,
      payloadJson: {
        generatedPackagePath: "/tmp/generated-workflows",
        extensionsGeneratedPackagePath: "/tmp/generated-extensions",
      },
    });
    const duplicate = store.ensureRecoveryWork({
      scope: { kind: "app" },
      kind: "generated_package_refresh",
      ownerScope: { kind: "workspace" },
      idempotencyKey: "generated_package_refresh:workspace",
      orderingKey: "workspace:root",
      orderingSeq: 0,
      priority: 5,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 3,
    });
    store.ensureRecoveryWork({
      scope: { kind: "workspace", workspaceId: store.workspaceId },
      kind: "title_generation",
      ownerScope: { kind: "title_job", titleJobId: "session:session-recovery-title" },
      idempotencyKey: "title_generation:session:session-recovery-title",
      orderingKey: "workspace:root",
      orderingSeq: 1,
      priority: 90,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 3,
      payloadJson: { reason: "startup" },
    });

    expect(duplicate.id).toBe(workflowsRefresh.id);
    expect(store.claimNextRecoveryWork({ claimedBy: "coordinator-a" })).toMatchObject({
      id: workflowsRefresh.id,
      kind: "generated_package_refresh",
      scope: { kind: "app" },
      status: "claimed",
      attempts: 1,
      ownerScope: { kind: "workspace" },
      payloadJson: {
        generatedPackagePath: "/tmp/generated-workflows",
        extensionsGeneratedPackagePath: "/tmp/generated-extensions",
      },
    });
  });

  it("rejects workspace-scoped source reconciliation recovery", () => {
    const store = createStore();
    expect(() =>
      store.ensureRecoveryWork({
        scope: { kind: "workspace", workspaceId: store.workspaceId },
        kind: "source_reconcile",
        ownerScope: {
          kind: "source",
          sourceKind: "workflow-agent",
          sourceId: "sharedAgent",
        },
        idempotencyKey: "source_reconcile:shared",
        orderingKey: `workspace:${store.workspaceId}`,
        orderingSeq: 0,
        priority: 5,
        availableAt: "2026-04-18T09:00:00.000Z",
        maxAttempts: 3,
      }),
    ).toThrow("source_reconcile recovery work must be app-scoped");
  });

  it("reclaims expired app recovery claims with lease fencing", () => {
    const store = createStore();
    const work = store.ensureRecoveryWork({
      scope: { kind: "app" },
      kind: "source_reconcile",
      ownerScope: {
        kind: "source",
        sourceKind: "workflow-agent",
        sourceId: "expiredAgent",
      },
      idempotencyKey: "source_reconcile:expiredAgent",
      orderingKey: "source:workflow-agent:expiredAgent",
      orderingSeq: 1,
      priority: 5,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 5,
    });
    const staleClaim = store.claimNextRecoveryWork({
      claimedBy: "expired-source-worker",
      scope: { kind: "app" },
      kinds: ["source_reconcile"],
      leaseMs: -1,
    });
    const reclaimed = store.claimNextRecoveryWork({
      claimedBy: "replacement-source-worker",
      scope: { kind: "app" },
      kinds: ["source_reconcile"],
    });

    expect(staleClaim).toMatchObject({ id: work.id, leaseVersion: 1, attempts: 1 });
    expect(reclaimed).toMatchObject({
      id: work.id,
      status: "claimed",
      claimedBy: "replacement-source-worker",
      leaseVersion: 2,
      attempts: 2,
    });
    expect(() =>
      store.completeRecoveryWork({
        id: work.id,
        claimedBy: staleClaim!.claimedBy,
        leaseVersion: staleClaim!.leaseVersion,
      }),
    ).toThrow("Recovery work claim is stale");
  });

  it("terminalizes an expired final attempt and unblocks the next ordered row", () => {
    const store = createStore();
    const earlier = store.ensureRecoveryWork({
      scope: { kind: "app" },
      kind: "source_reconcile",
      ownerScope: {
        kind: "source",
        sourceKind: "workflow-agent",
        sourceId: "crashedAgent",
      },
      idempotencyKey: "source_reconcile:crashedAgent:1",
      orderingKey: "source:workflow-agent:crashedAgent",
      orderingSeq: 1,
      priority: 5,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 1,
    });
    const later = store.ensureRecoveryWork({
      scope: { kind: "app" },
      kind: "source_reconcile",
      ownerScope: {
        kind: "source",
        sourceKind: "workflow-agent",
        sourceId: "crashedAgent",
      },
      idempotencyKey: "source_reconcile:crashedAgent:2",
      orderingKey: "source:workflow-agent:crashedAgent",
      orderingSeq: 2,
      priority: 5,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 2,
    });
    expect(
      store.claimNextRecoveryWork({
        claimedBy: "crashed-source-worker",
        scope: { kind: "app" },
        kinds: ["source_reconcile"],
        leaseMs: -1,
      })?.id,
    ).toBe(earlier.id);

    expect(
      store.claimNextRecoveryWork({
        claimedBy: "replacement-source-worker",
        scope: { kind: "app" },
        kinds: ["source_reconcile"],
      })?.id,
    ).toBe(later.id);
    expect(store.listRecoveryWork().find((work) => work.id === earlier.id)).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "Recovery claim expired after its final attempt.",
    });
  });

  it("clears expired claims outside the requested kind before owner conflict checks", () => {
    const store = createStore();
    const expired = store.ensureRecoveryWork({
      scope: { kind: "app" },
      kind: "queue_delivery",
      ownerScope: { kind: "workspace" },
      idempotencyKey: "queue_delivery:mixed-expiry",
      orderingKey: "mixed-expiry-order",
      orderingSeq: 2,
      priority: 5,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 2,
    });
    expect(
      store.claimNextRecoveryWork({
        claimedBy: "expired-queue-worker",
        scope: { kind: "app" },
        kinds: ["queue_delivery"],
        leaseMs: -1,
      })?.id,
    ).toBe(expired.id);
    const source = store.ensureRecoveryWork({
      scope: { kind: "app" },
      kind: "source_reconcile",
      ownerScope: {
        kind: "source",
        sourceKind: "workflow-agent",
        sourceId: "mixedExpiryAgent",
      },
      idempotencyKey: "source_reconcile:mixed-expiry",
      orderingKey: "mixed-expiry-order",
      orderingSeq: 1,
      priority: 5,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 2,
    });

    expect(
      store.claimNextRecoveryWork({
        claimedBy: "source-worker",
        scope: { kind: "app" },
        kinds: ["source_reconcile"],
      })?.id,
    ).toBe(source.id);
    expect(store.listRecoveryWork().find((work) => work.id === expired.id)).toMatchObject({
      status: "pending",
      attempts: 1,
    });
  });

  it("keeps later recovery work behind an unavailable earlier row for the same ordering key", () => {
    const store = createStore();
    const earlier = store.ensureRecoveryWork({
      scope: { kind: "app" },
      kind: "source_reconcile",
      ownerScope: {
        kind: "source",
        sourceKind: "workflow-agent",
        sourceId: "orderedAgent",
      },
      idempotencyKey: "source_reconcile:orderedAgent:1",
      orderingKey: "source:workflow-agent:orderedAgent",
      orderingSeq: 1,
      priority: 5,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 5,
    });
    const later = store.ensureRecoveryWork({
      scope: { kind: "app" },
      kind: "source_reconcile",
      ownerScope: {
        kind: "source",
        sourceKind: "workflow-agent",
        sourceId: "orderedAgent",
      },
      idempotencyKey: "source_reconcile:orderedAgent:2",
      orderingKey: "source:workflow-agent:orderedAgent",
      orderingSeq: 2,
      priority: 5,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 5,
    });
    const independent = store.ensureRecoveryWork({
      scope: { kind: "app" },
      kind: "source_reconcile",
      ownerScope: {
        kind: "source",
        sourceKind: "workflow-agent",
        sourceId: "independentAgent",
      },
      idempotencyKey: "source_reconcile:independentAgent",
      orderingKey: "source:workflow-agent:independentAgent",
      orderingSeq: 1,
      priority: 10,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 5,
    });
    const claimedEarlier = store.claimNextRecoveryWork({
      claimedBy: "source-worker",
      scope: { kind: "app" },
      kinds: ["source_reconcile"],
    });
    const retryAvailableAt = "2099-01-01T00:00:00.000Z";
    const retried = store.failOrRetryRecoveryWork({
      id: claimedEarlier!.id,
      error: "Retry later.",
      claimedBy: claimedEarlier!.claimedBy,
      leaseVersion: claimedEarlier!.leaseVersion,
      retryAvailableAt,
    });
    const next = store.claimNextRecoveryWork({
      claimedBy: "source-worker",
      scope: { kind: "app" },
      kinds: ["source_reconcile"],
    });

    expect(claimedEarlier?.id).toBe(earlier.id);
    expect(retried).toMatchObject({ status: "pending", availableAt: retryAvailableAt });
    expect(next?.id).toBe(independent.id);
    expect(store.listRecoveryWork().find((entry) => entry.id === later.id)).toMatchObject({
      status: "pending",
    });
  });

  it("rejects generated-package recovery work in the wrong scope", () => {
    const store = createStore();
    expect(() =>
      store.ensureRecoveryWork({
        scope: { kind: "workspace", workspaceId: store.workspaceId },
        kind: "generated_package_refresh",
        ownerScope: { kind: "workspace" },
        idempotencyKey: "generated_package_refresh:invalid-workspace",
        orderingKey: `workspace:${store.workspaceId}`,
        orderingSeq: 0,
        priority: 5,
        availableAt: "2026-04-18T09:00:00.000Z",
        maxAttempts: 3,
      }),
    ).toThrow("generated_package_refresh recovery work must be app-scoped");
    expect(() =>
      store.ensureRecoveryWork({
        scope: { kind: "app" },
        kind: "workspace_generated_package_link_repair",
        ownerScope: { kind: "workspace" },
        idempotencyKey: "workspace_generated_package_link_repair:invalid-app",
        orderingKey: "app:generated-package-link",
        orderingSeq: 0,
        priority: 5,
        availableAt: "2026-04-18T09:00:00.000Z",
        maxAttempts: 3,
      }),
    ).toThrow("workspace_generated_package_link_repair recovery work must be workspace-scoped");
  });

  it("normalizes stale recovery leases and interrupted queue rows on coordinator startup", () => {
    const store = createStore();
    seedSession(store, "session-recovery-normalize");
    const queued = store.enqueueSurfaceMessage({
      sessionId: "session-recovery-normalize",
      surfacePiSessionId: "surface-recovery-normalize",
      messageJson: JSON.stringify({ role: "user", content: "Recover this prompt" }),
    });
    store.claimNextQueuedSurfaceMessage({ surfacePiSessionId: "surface-recovery-normalize" });
    const work = store.ensureRecoveryWork({
      scope: { kind: "workspace", workspaceId: store.workspaceId },
      kind: "queue_delivery",
      ownerScope: {
        kind: "surface",
        workspaceSessionId: "session-recovery-normalize",
        surfacePiSessionId: "surface-recovery-normalize",
      },
      idempotencyKey: "queue_delivery:surface-recovery-normalize",
      orderingKey: "surface:surface-recovery-normalize",
      orderingSeq: 0,
      priority: 30,
      availableAt: "2026-04-18T09:00:00.000Z",
      maxAttempts: 3,
    });
    store.claimNextRecoveryWork({ claimedBy: "stale-coordinator", leaseMs: -1 });

    store.normalizeWorkspaceRecoveryState({ claimedBy: "fresh-coordinator" });

    expect(store.getSurfaceQueuedMessage({ id: queued.id }).status).toBe("queued");
    expect(store.listRecoveryWork().find((entry) => entry.id === work.id)).toMatchObject({
      status: "pending",
      claimedBy: null,
    });
  });

  it("skips no-op queued message reorders and records only committed order changes", () => {
    const store = createStore();
    seedSession(store, "session-queue-reorder");

    const first = store.enqueueSurfaceMessage({
      sessionId: "session-queue-reorder",
      surfacePiSessionId: "surface-queue-reorder",
      messageJson: JSON.stringify({ role: "user", content: "First queued prompt" }),
    });
    const second = store.enqueueSurfaceMessage({
      sessionId: "session-queue-reorder",
      surfacePiSessionId: "surface-queue-reorder",
      messageJson: JSON.stringify({ role: "user", content: "Second queued prompt" }),
    });
    const third = store.enqueueSurfaceMessage({
      sessionId: "session-queue-reorder",
      surfacePiSessionId: "surface-queue-reorder",
      messageJson: JSON.stringify({ role: "user", content: "Third queued prompt" }),
    });

    store.reorderSurfaceMessage({
      surfacePiSessionId: "surface-queue-reorder",
      id: second.id,
      beforeId: third.id,
    });
    expect(
      store
        .getSessionState("session-queue-reorder")
        .events.filter((event) => event.kind === "surfaceMessage.reordered"),
    ).toHaveLength(0);

    store.reorderSurfaceMessage({
      surfacePiSessionId: "surface-queue-reorder",
      id: third.id,
      beforeId: first.id,
    });
    const snapshot = store.getSessionState("session-queue-reorder");
    expect(snapshot.queuedMessages?.map((message) => [message.id, message.position])).toEqual([
      [third.id, 1],
      [first.id, 2],
      [second.id, 3],
    ]);
    expect(
      snapshot.events.filter((event) => event.kind === "surfaceMessage.reordered"),
    ).toHaveLength(1);
  });

  it("records handler workflow runs without legacy Project CI state records", () => {
    const store = createStore();
    seedSession(store, "session-thread-context");

    const orchestratorTurn = store.startTurn({
      sessionId: "session-thread-context",
      surfacePiSessionId: "session-thread-context",
      requestSummary: "Start a handler thread",
    });
    const thread = store.createThread({
      turnId: orchestratorTurn.id,
      surfacePiSessionId: "pi-thread-context",
      title: "Context thread",
      objective: "Run a delegated workflow.",
    });
    const handlerTurn = store.startTurn({
      sessionId: "session-thread-context",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      requestSummary: "Run workflow",
    });
    const workflowCommand = store.createCommand({
      turnId: handlerTurn.id,
      threadId: thread.id,
      toolName: "exec_command",
      executor: "handler",
      visibility: "surface",
      title: "Start workflow",
      summary: "Start the workflow run.",
    });
    const workflowRun = store.recordWorkflow({
      threadId: thread.id,
      commandId: workflowCommand.id,
      smithersRunId: "smithers-run-context",
      workflowName: "context_workflow",
      workflowSource: "saved",
      entryPath: ".svvy/workflows/entries/context-workflow.tsx",
      savedEntryId: "context_workflow",
      status: "completed",
      summary: "Workflow finished.",
    });

    const snapshot = store.getSessionState("session-thread-context");
    expect(snapshot.workflowRuns).toEqual([expect.objectContaining({ id: workflowRun.id })]);
    expect("ciRuns" in snapshot).toBe(false);
    expect("ciCheckResults" in snapshot).toBe(false);
  });

  it("keeps artifact ownership thread-based after an episode exists", () => {
    const store = createStore();
    seedSession(store, "session-artifacts");

    const turn = store.startTurn({
      sessionId: "session-artifacts",
      surfacePiSessionId: "session-artifacts",
      requestSummary: "Write artifacts after the thread completes",
    });
    const thread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-artifacts",
      title: "Artifact thread",
      objective: "Create artifacts after terminal episode creation.",
    });
    const handlerTurn = store.startTurn({
      sessionId: "session-artifacts",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      requestSummary: "Write the terminal handler episode and artifact",
    });
    const command = store.createCommand({
      turnId: handlerTurn.id,
      threadId: thread.id,
      toolName: "execute_typescript",
      executor: "handler",
      visibility: "summary",
      title: "Draft artifact",
      summary: "Draft an artifact.",
    });
    store.updateThread({
      threadId: thread.id,
      status: "completed",
    });
    store.createEpisode({
      threadId: thread.id,
      sourceCommandId: command.id,
      title: "Final episode",
      summary: "Thread completed.",
      body: "Thread completed.",
    });
    const artifact = store.createArtifact({
      threadId: thread.id,
      sourceCommandId: command.id,
      kind: "text",
      name: "notes.md",
      content: "# Notes\nArtifact ownership now hangs off the thread.\n",
    });

    expect(artifact.threadId).toBe(thread.id);
    expect(artifact.workflowRunId).toBeNull();
    expect(artifact.sourceCommandId).toBe(command.id);
    expect(store.getThreadDetail(thread.id).artifacts.map((entry) => entry.id)).toEqual([
      artifact.id,
    ]);
  });

  it("stores workflow task attempts, transcript messages, and nested command or artifact ownership under the owning workflow run", () => {
    const store = createStore();
    seedSession(store, "session-workflow-task-attempts");

    const orchestratorTurn = store.startTurn({
      sessionId: "session-workflow-task-attempts",
      surfacePiSessionId: "session-workflow-task-attempts",
      requestSummary: "Open a delegated workflow handler",
    });
    const thread = store.createThread({
      turnId: orchestratorTurn.id,
      surfacePiSessionId: "pi-thread-workflow-task-attempts",
      title: "Workflow task attempt thread",
      objective: "Inspect durable task-agent attempts.",
    });
    const handlerTurn = store.startTurn({
      sessionId: "session-workflow-task-attempts",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      requestSummary: "Launch a workflow that uses the task agent",
    });
    const launchCommand = store.createCommand({
      turnId: handlerTurn.id,
      threadId: thread.id,
      toolName: "exec_command",
      executor: "handler",
      visibility: "surface",
      title: "Run task workflow through Shell",
      summary: "Launch the task-agent workflow.",
    });
    const workflowRun = store.recordWorkflow({
      threadId: thread.id,
      commandId: launchCommand.id,
      smithersRunId: "smithers-run-task-attempt",
      workflowName: "execute_typescript_task",
      workflowSource: "saved",
      entryPath: ".svvy/workflows/entries/execute-typescript-task.tsx",
      savedEntryId: "execute_typescript_task",
      status: "running",
      summary: "Task workflow is running.",
    });

    const workflowTaskAttempt = store.upsertWorkflowTaskAttempt({
      workflowRunId: workflowRun.id,
      smithersRunId: workflowRun.smithersRunId,
      nodeId: "task",
      iteration: 0,
      attempt: 1,
      surfacePiSessionId: "pi-task-agent-001",
      title: "task",
      summary: "Workflow task attempt is running.",
      kind: "agent",
      status: "running",
      smithersState: "in-progress",
      prompt: "Inspect docs and write a proof file.",
      agentEngine: "pi",
      agentResume: "/tmp/task-agent-session.json",
      generatedAgentContextFingerprint: "workflow-task-fingerprint-001",
      generatedAgentContextBinding: {
        aggregateCacheKey: "workflow-task-aggregate-001",
        systemPrompt: "Use the initial workflow task generated context.",
        svvyxGuidance: "Workflow svvyx guidance.",
        commandsDts: "declare const workflowTask: true;",
        nativeToolSchemasJson: "{}",
        generatedAgentContextRevision: 3,
        loadedExtensionIds: ["base-workflow-task", "shell"],
        availableExtensionIds: ["github"],
        externalSourceHashes: ["AGENTS.md:initial:true"],
      },
      meta: {
        kind: "agent",
        agentResume: "/tmp/task-agent-session.json",
      },
    });
    const workflowTaskQueueRow = store.enqueueSurfaceMessage({
      sessionId: "session-workflow-task-attempts",
      surfacePiSessionId: workflowTaskAttempt.surfacePiSessionId!,
      threadId: thread.id,
      workflowTaskAttemptId: workflowTaskAttempt.id,
      kind: "workflow_task_agent_start",
      idempotencyKey:
        "workflow-task-agent-start:session-workflow-task-attempts:cmd:smithers-run-task-attempt:task:0:1:agent",
      priority: "runtime",
      orderingKey: `workflow-task-attempt:${workflowTaskAttempt.id}`,
      sourceCommandId: launchCommand.id,
      messageJson: "{}",
      payloadJson: JSON.stringify({
        kind: "workflow_task_agent_start",
        workflowTaskAttemptId: workflowTaskAttempt.id,
        taskIdentity: {
          runId: "smithers-run-001",
          nodeId: "review",
          iteration: 0,
          attempt: 1,
        },
        smithersContext: {
          rootDir: "/tmp/workspace",
        },
        agent: {
          id: "reviewer",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "high" },
          instructions: "Review the current implementation.",
        },
        promptSource: {
          kind: "prompt",
          prompt: "Review the focused implementation.",
        },
      }),
    });
    expect(workflowTaskQueueRow).toMatchObject({
      kind: "workflow_task_agent_start",
      workflowTaskAttemptId: workflowTaskAttempt.id,
      sourceCommandId: launchCommand.id,
      orderingKey: `workflow-task-attempt:${workflowTaskAttempt.id}`,
    });
    const taskCommand = store.createCommand({
      workflowTaskAttemptId: workflowTaskAttempt.id,
      surfacePiSessionId: "pi-task-agent-001",
      toolName: "execute_typescript",
      executor: "workflow-task-agent",
      visibility: "summary",
      title: "Run task execute_typescript",
      summary: "Execute bounded task-agent work.",
    });
    store.startCommand(taskCommand.id);
    store.finishCommand({
      commandId: taskCommand.id,
      status: "succeeded",
      summary: "Task-agent execution completed.",
    });
    const taskArtifact = store.createArtifact({
      workflowTaskAttemptId: workflowTaskAttempt.id,
      sourceCommandId: taskCommand.id,
      kind: "text",
      name: "workflow-proof.txt",
      content: "Workflow proof\n",
    });
    store.replaceWorkflowTaskMessages({
      workflowTaskAttemptId: workflowTaskAttempt.id,
      messages: [
        {
          id: "workflow-task-message-user",
          role: "user",
          source: "prompt",
          text: "Inspect docs and write a proof file.",
          createdAt: "2026-04-18T09:00:10.000Z",
        },
        {
          id: "workflow-task-message-assistant",
          role: "assistant",
          source: "responseText",
          text: '{"status":"completed"}',
          createdAt: "2026-04-18T09:00:20.000Z",
        },
      ],
    });
    store.upsertWorkflowTaskAttempt({
      workflowRunId: workflowRun.id,
      smithersRunId: workflowRun.smithersRunId,
      nodeId: "task",
      iteration: 0,
      attempt: 1,
      summary: "Workflow task attempt completed.",
      kind: "agent",
      status: "completed",
      smithersState: "finished",
      responseText: '{"status":"completed"}',
      agentResume: "/tmp/task-agent-session.json",
      generatedAgentContextBinding: {
        aggregateCacheKey: "workflow-task-aggregate-001",
        systemPrompt: "Use the initial workflow task generated context.",
        svvyxGuidance: "Workflow svvyx guidance.",
        commandsDts: "declare const workflowTask: true;",
        nativeToolSchemasJson: "{}",
        generatedAgentContextRevision: 3,
        loadedExtensionIds: ["base-workflow-task", "shell"],
        availableExtensionIds: ["github"],
        externalSourceHashes: ["AGENTS.md:initial:true"],
      },
      meta: {
        kind: "agent",
        agentResume: "/tmp/task-agent-session.json",
      },
      startedAt: "2026-04-18T09:00:10.000Z",
      finishedAt: "2026-04-18T09:00:20.000Z",
    });

    const snapshot = store.getSessionState("session-workflow-task-attempts");
    expect(snapshot.generatedAgentContextBindings).toEqual([
      expect.objectContaining({
        ownerKind: "workflow-task-attempt",
        ownerId: workflowTaskAttempt.id,
        actorKind: "workflow-task",
        surfacePiSessionId: "pi-task-agent-001",
        systemPrompt: "Use the initial workflow task generated context.",
        generatedAgentContextFingerprint: "workflow-task-fingerprint-001",
        generatedAgentContextRevision: 3,
        loadedExtensionIds: ["base-workflow-task", "shell"],
        availableExtensionIds: ["github"],
        externalSourceHashes: ["AGENTS.md:initial:true"],
      }),
    ]);
    expect(snapshot.workflowTaskAttempts).toEqual([
      expect.objectContaining({
        id: workflowTaskAttempt.id,
        threadId: thread.id,
        workflowRunId: workflowRun.id,
        nodeId: "task",
        attempt: 1,
        status: "completed",
        agentResume: "/tmp/task-agent-session.json",
        generatedAgentContextFingerprint: "workflow-task-fingerprint-001",
      }),
    ]);
    expect(snapshot.commands).toContainEqual(
      expect.objectContaining({
        id: taskCommand.id,
        workflowTaskAttemptId: workflowTaskAttempt.id,
        workflowRunId: workflowRun.id,
        threadId: thread.id,
        executor: "workflow-task-agent",
      }),
    );
    expect(snapshot.artifacts).toContainEqual(
      expect.objectContaining({
        id: taskArtifact.id,
        workflowTaskAttemptId: workflowTaskAttempt.id,
        workflowRunId: workflowRun.id,
        sourceCommandId: taskCommand.id,
      }),
    );
    expect(snapshot.workflowTaskMessages.map((message) => message.id)).toEqual([
      "workflow-task-message-user",
      "workflow-task-message-assistant",
    ]);
    expect(
      store.findWorkflowTaskAttemptBySmithersIdentity({
        smithersRunId: workflowRun.smithersRunId,
        nodeId: "task",
        iteration: 0,
        attempt: 1,
      }),
    ).toEqual(
      expect.objectContaining({
        id: workflowTaskAttempt.id,
      }),
    );
    expect(store.getThreadDetail(thread.id).workflowTaskAttempts).toEqual([
      expect.objectContaining({
        id: workflowTaskAttempt.id,
      }),
    ]);
  });

  it("enforces durable Smithers run and task-attempt identity uniqueness", () => {
    const store = createStore();
    seedSession(store, "session-smithers-identity");
    const turn = store.startTurn({
      sessionId: "session-smithers-identity",
      surfacePiSessionId: "session-smithers-identity",
      requestSummary: "Delegate identity check",
    });
    const thread = store.createThread({
      turnId: turn.id,
      title: "Identity Check",
      objective: "Check exact Smithers identities.",
    });
    const command = store.createCommand({
      turnId: turn.id,
      threadId: thread.id,
      toolName: "exec_command",
      executor: "handler",
      visibility: "surface",
      title: "Run identity workflow through Shell",
      summary: "Launch the identity workflow.",
    });
    const workflowRun = store.recordWorkflow({
      threadId: thread.id,
      commandId: command.id,
      smithersRunId: "smithers-run-unique",
      workflowName: "identity",
      workflowSource: "saved",
      status: "running",
      summary: "Identity workflow is running.",
    });

    expect(() =>
      store.recordWorkflow({
        threadId: thread.id,
        commandId: command.id,
        smithersRunId: "smithers-run-unique",
        workflowName: "identity-duplicate",
        workflowSource: "saved",
        status: "running",
        summary: "Duplicate run should fail.",
      }),
    ).toThrow();

    const first = store.upsertWorkflowTaskAttempt({
      workflowRunId: workflowRun.id,
      smithersRunId: workflowRun.smithersRunId,
      nodeId: "task",
      iteration: 0,
      attempt: 1,
      summary: "Task is running.",
      kind: "agent",
      status: "running",
      smithersState: "in-progress",
      agentResume: "/tmp/first-session.jsonl",
      generatedAgentContextFingerprint: "workflow-task-fingerprint-001",
    });
    const updated = store.upsertWorkflowTaskAttempt({
      workflowRunId: workflowRun.id,
      smithersRunId: workflowRun.smithersRunId,
      nodeId: "task",
      iteration: 0,
      attempt: 1,
      summary: "Task is still running.",
      kind: "agent",
      status: "running",
      smithersState: "in-progress",
      agentResume: "/tmp/second-session.jsonl",
    });

    expect(updated.id).toBe(first.id);
    expect(
      store.findWorkflowTaskAttemptBySmithersIdentity({
        smithersRunId: workflowRun.smithersRunId,
        nodeId: "task",
        iteration: 0,
        attempt: 1,
      }),
    ).toMatchObject({
      id: first.id,
      agentResume: "/tmp/second-session.jsonl",
      generatedAgentContextFingerprint: "workflow-task-fingerprint-001",
    });
    const refreshed = store.upsertWorkflowTaskAttempt({
      workflowRunId: workflowRun.id,
      smithersRunId: workflowRun.smithersRunId,
      nodeId: "task",
      iteration: 0,
      attempt: 1,
      summary: "Task refreshed generated context.",
      kind: "agent",
      status: "running",
      smithersState: "in-progress",
      generatedAgentContextFingerprint: "workflow-task-fingerprint-002",
    });
    expect(refreshed.generatedAgentContextFingerprint).toBe("workflow-task-fingerprint-002");
    expect(() =>
      store.upsertWorkflowTaskAttempt({
        workflowRunId: workflowRun.id,
        smithersRunId: "different-smithers-run",
        nodeId: "task",
        iteration: 0,
        attempt: 1,
        summary: "Mismatched run should fail.",
        kind: "agent",
        status: "running",
        smithersState: "in-progress",
      }),
    ).toThrow("not different-smithers-run");
  });
});
