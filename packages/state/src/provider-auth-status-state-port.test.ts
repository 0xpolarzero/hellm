import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  ProviderAuthStatusStatePort,
  type ProviderId,
  type ProviderAuthStatus,
  type RecordProviderAuthStatusInput,
  type WorkspaceId,
} from "@svvy/core";
import {
  layerProviderAuthStatusStatePort,
  providerAuthStatusStatePortFromStore,
} from "./provider-auth-status-state-port";
import {
  createStructuredSessionStateStore,
  layerStructuredSessionState,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_provider_auth_status_state_port",
  cwd: "/tmp/svvy-provider-auth-status-state-port",
  label: "Provider auth status state port",
};

const providerId = (value: string): ProviderId => value as ProviderId;
const workspaceId = (value: string): WorkspaceId => value as WorkspaceId;
const statusDateTime = (value: string): NonNullable<ProviderAuthStatus["refreshedAt"]> =>
  value as NonNullable<ProviderAuthStatus["refreshedAt"]>;
const observedAt = (value: string): RecordProviderAuthStatusInput["observedAt"] =>
  value as RecordProviderAuthStatusInput["observedAt"];

describe("ProviderAuthStatusStatePort", () => {
  it("returns an empty provider auth list for a fresh store", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = providerAuthStatusStatePortFromStore(store);
    try {
      await expect(runTestEffect(port.listProviderStatuses({}))).resolves.toEqual([]);
    } finally {
      store.close();
    }
  });

  it("records secret-free provider status and invalidates provider auth", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = providerAuthStatusStatePortFromStore(store);
    const openai = providerId("openai");
    try {
      const result = await runTestEffect(
        port.recordProviderStatus({
          status: {
            providerId: openai,
            health: "usable",
            redactedAccountLabel: "acct...1234",
            refreshedAt: statusDateTime("2026-04-18T10:00:00.000Z"),
            expiresAt: statusDateTime("2026-04-18T11:00:00.000Z"),
          },
          observedAt: observedAt("2026-04-18T10:00:01.000Z"),
          source: "provider_refresh",
        }),
      );

      expect(result.value).toEqual({
        providerId: openai,
        health: "usable",
        redactedAccountLabel: "acct...1234",
        refreshedAt: statusDateTime("2026-04-18T10:00:00.000Z"),
        expiresAt: statusDateTime("2026-04-18T11:00:00.000Z"),
      });
      expect(result.afterCommit).toEqual([
        { scope: "app", invalidation: { model: "providerAuth", ids: [openai] } },
      ]);
      await expect(runTestEffect(port.listProviderStatuses({}))).resolves.toEqual([result.value]);
    } finally {
      store.close();
    }
  });

  it("updates provider status rows by provider and workspace scope", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = providerAuthStatusStatePortFromStore(store);
    const anthropic = providerId("anthropic");
    const scopedWorkspace = workspaceId("workspace_auth_scope");
    try {
      await runTestEffect(
        port.recordProviderStatus({
          status: {
            providerId: anthropic,
            health: "expired",
            expiresAt: statusDateTime("2026-04-18T10:00:00.000Z"),
            issue: "Token expired.",
          },
          observedAt: observedAt("2026-04-18T10:00:01.000Z"),
          source: "startup_scan",
        }),
      );
      const updated = await runTestEffect(
        port.recordProviderStatus({
          status: {
            providerId: anthropic,
            workspaceId: scopedWorkspace,
            health: "refresh_failed",
            issue: "Refresh token rejected.",
          },
          observedAt: observedAt("2026-04-18T10:05:01.000Z"),
          source: "runtime_retry",
        }),
      );

      await expect(runTestEffect(port.listProviderStatuses({}))).resolves.toEqual([
        {
          providerId: anthropic,
          health: "expired",
          expiresAt: statusDateTime("2026-04-18T10:00:00.000Z"),
          issue: "Token expired.",
        },
      ]);
      await expect(
        runTestEffect(port.listProviderStatuses({ workspaceId: scopedWorkspace })),
      ).resolves.toEqual([updated.value]);
    } finally {
      store.close();
    }
  });

  it("persists provider auth status across SQLite reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "svvy-provider-auth-status-port-"));
    const databasePath = join(dir, "state.sqlite");
    const openai = providerId("openai");
    try {
      const store = createStructuredSessionStateStore({ databasePath, workspace });
      const port = providerAuthStatusStatePortFromStore(store);
      await runTestEffect(
        port.recordProviderStatus({
          status: {
            providerId: openai,
            health: "missing",
            issue: "No credential configured.",
          },
          observedAt: observedAt("2026-04-18T10:00:01.000Z"),
          source: "startup_scan",
        }),
      );
      store.close();

      const reopened = createStructuredSessionStateStore({ databasePath, workspace });
      const reopenedPort = providerAuthStatusStatePortFromStore(reopened);
      const statuses = await runTestEffect(reopenedPort.listProviderStatuses({}));
      reopened.close();

      expect(statuses).toEqual([
        {
          providerId: openai,
          health: "missing",
          issue: "No credential configured.",
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("provides provider auth status through the state layer", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const port = yield* ProviderAuthStatusStatePort;
          yield* port.recordProviderStatus({
            status: {
              providerId: providerId("openai"),
              health: "usable",
              refreshedAt: statusDateTime("2026-04-18T10:00:00.000Z"),
            },
            observedAt: observedAt("2026-04-18T10:00:01.000Z"),
            source: "user_action",
          });
          const statuses = yield* port.listProviderStatuses({});
          expect(statuses).toEqual([
            {
              providerId: providerId("openai"),
              health: "usable",
              refreshedAt: statusDateTime("2026-04-18T10:00:00.000Z"),
            },
          ]);
        }).pipe(
          Effect.provide(
            layerProviderAuthStatusStatePort.pipe(
              Layer.provideMerge(layerStructuredSessionState({ workspace })),
            ),
          ),
        ),
      ),
    );
  });
});
