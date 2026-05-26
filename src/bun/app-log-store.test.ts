import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createAppLogStore } from "./app-log-store";

function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 4, 13, 10, 0, tick++)).toISOString();
}

describe("app log store", () => {
  it("allocates monotonic sequences and summarizes unread by level", () => {
    const store = createAppLogStore({ now: clock() });
    const first = store.append({ level: "info", source: "app.lifecycle", message: "ready" });
    const second = store.append({ level: "warning", source: "auth.provider", message: "missing" });
    const third = store.append({ level: "error", source: "prompt", message: "failed" });

    expect([first.seq, second.seq, third.seq]).toEqual([1, 2, 3]);
    expect(store.summary()).toMatchObject({
      latestSeq: 3,
      seenSeq: 0,
      unread: { total: 3, info: 1, warning: 1, error: 1 },
      totals: { total: 3, info: 1, warning: 1, error: 1 },
    });

    expect(store.markSeen(2)).toMatchObject({
      latestSeq: 3,
      seenSeq: 2,
      unread: { total: 1, info: 0, warning: 0, error: 1 },
    });
    store.close();
  });

  it("filters by level, source, query, afterSeq, and beforeSeq", () => {
    const store = createAppLogStore({ now: clock() });
    store.append({ level: "info", source: "workspace", message: "cwd resolved" });
    store.append({
      level: "warning",
      source: "workflow.library",
      message: "validation diagnostics",
    });
    store.append({ level: "error", source: "execute-typescript", message: "compile failed" });

    expect(store.query({ levels: ["warning"] }).entries.map((entry) => entry.source)).toEqual([
      "workflow.library",
    ]);
    expect(
      store.query({ sources: ["execute-typescript"] }).entries.map((entry) => entry.level),
    ).toEqual(["error"]);
    expect(store.query({ query: "diagnostics" }).entries.map((entry) => entry.seq)).toEqual([2]);
    expect(store.query({ afterSeq: 1 }).entries.map((entry) => entry.seq)).toEqual([2, 3]);
    expect(store.query({ beforeSeq: 3 }).entries.map((entry) => entry.seq)).toEqual([1, 2]);
    store.close();
  });

  it("searches related ids consistently with renderer filtering", () => {
    const store = createAppLogStore({ now: clock() });
    store.append({ level: "info", source: "workspace", message: "plain" });
    store.append({
      level: "error",
      source: "workflow.run",
      message: "failed",
      workspaceSessionId: "session-1",
      surfacePiSessionId: "surface-1",
      threadId: "thread-1",
      workflowRunId: "run-1",
      workflowTaskAttemptId: "task-1",
      commandId: "cmd-1",
    });

    for (const query of ["session-1", "surface-1", "thread-1", "run-1", "task-1", "cmd-1"]) {
      expect(store.query({ query }).entries.map((entry) => entry.seq)).toEqual([2]);
    }
    store.close();
  });

  it("redacts secrets before persistence and live delivery", () => {
    const store = createAppLogStore({ now: clock() });
    const delivered: unknown[] = [];
    store.subscribe((entries) => delivered.push(entries[0]));

    const entry = store.append({
      level: "error",
      source: "auth.provider",
      message: "Authorization=Bearer abcdefghijklmnopqrstuvwxyzABCDEF1234567890",
      details: {
        apiKey: "sk-abcdefghijklmnopqrstuvwxyzABCDEF1234567890",
        nested: {
          cookie: "session=secret",
          harmless: "visible",
        },
      },
      error: new Error("Bearer abcdefghijklmnopqrstuvwxyzABCDEF1234567890 failed"),
    });

    const persisted = store.query().entries[0]!;
    expect(JSON.stringify(entry)).not.toContain("abcdefghijklmnopqrstuvwxyzABCDEF1234567890");
    expect(JSON.stringify(persisted)).not.toContain("abcdefghijklmnopqrstuvwxyzABCDEF1234567890");
    expect(JSON.stringify(delivered[0])).not.toContain(
      "abcdefghijklmnopqrstuvwxyzABCDEF1234567890",
    );
    expect(persisted.details).toMatchObject({
      apiKey: "[REDACTED]",
      nested: { cookie: "[REDACTED]", harmless: "visible" },
    });
    store.close();
  });

  it("keeps ordinary workspace paths visible while redacting token-shaped provider values", () => {
    const store = createAppLogStore({ now: clock() });
    const cwd = "/var/folders/bq/fnyn1bq95d37b4q3lrwc_f600000gn/T/svvy-dev-workspace-3qI4YM";
    const token = "abcdefghijklmnopqrstuvwxyzABCDEF1234567890";

    const entry = store.append({
      level: "info",
      source: "app.lifecycle",
      message: "startup",
      details: {
        workspaceCwd: cwd,
        providerTokenPreview: token,
      },
    });

    expect(entry.details?.workspaceCwd).toBe(cwd);
    expect(entry.details?.providerTokenPreview).toBe("[REDACTED]");
    store.close();
  });

  it("persists recent entries and seen state across reopen without reusing seq", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-app-logs-"));
    const databasePath = join(root, "logs.sqlite");
    const now = clock();
    const firstStore = createAppLogStore({ databasePath, now });
    firstStore.append({ level: "info", source: "workspace", message: "one" });
    firstStore.append({ level: "info", source: "workspace", message: "two" });
    firstStore.markSeen(2);
    firstStore.close();

    const secondStore = createAppLogStore({ databasePath, now });
    expect(secondStore.summary()).toMatchObject({ latestSeq: 2, seenSeq: 2 });
    const next = secondStore.append({ level: "info", source: "workspace", message: "three" });
    expect(next.seq).toBe(3);
    expect(secondStore.query().entries.map((entry) => entry.message)).toEqual([
      "one",
      "two",
      "three",
    ]);
    secondStore.close();
  });

  it("retains bounded history while keeping seq monotonic", () => {
    const store = createAppLogStore({ now: clock(), memoryLimit: 2, persistedLimit: 3 });
    for (let index = 0; index < 5; index += 1) {
      store.append({ level: "info", source: "workspace", message: `entry ${index}` });
    }

    expect(store.query({ limit: 10 }).entries.map((entry) => entry.seq)).toEqual([3, 4, 5]);
    expect(store.append({ level: "warning", source: "workspace", message: "next" }).seq).toBe(6);
    store.close();
  });
});
