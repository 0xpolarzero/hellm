import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import {
  getSvvySessionDir,
  WorkspaceSessionCatalog,
  type SessionDefaults,
} from "./session-catalog";

const tempDirs: string[] = [];

const DEFAULTS: SessionDefaults = {
  provider: "openai",
  model: "gpt-4o",
  thinkingLevel: "medium",
  systemPrompt: "You are svvy.",
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

function createWorkspaceFixture() {
  const root = mkdtempSync(join(tmpdir(), "svvy-sessions-"));
  tempDirs.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const sessionDir = getSvvySessionDir(cwd, agentDir);
  return { cwd, agentDir, sessionDir };
}

function userMessage(text: string): Message {
  return {
    role: "user",
    timestamp: Date.now(),
    content: [{ type: "text", text }],
  };
}

function assistantMessage(text: string): Message {
  return {
    role: "assistant",
    timestamp: Date.now(),
    api: "openai-responses",
    provider: "openai",
    model: "gpt-4o",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    content: [{ type: "text", text }],
  };
}

function createPersistedSession(
  cwd: string,
  sessionDir: string,
  options: {
    title?: string;
    prompt: string;
    reply: string;
    thinkingLevel?: ThinkingLevel;
  },
) {
  const sessionManager = SessionManager.create(cwd, sessionDir);
  if (options.title) {
    sessionManager.appendSessionInfo(options.title);
  }
  if (options.thinkingLevel) {
    sessionManager.appendThinkingLevelChange(options.thinkingLevel);
  }
  sessionManager.appendMessage(userMessage(options.prompt));
  sessionManager.appendMessage(assistantMessage(options.reply));
  return {
    id: sessionManager.getSessionId(),
    path: sessionManager.getSessionFile(),
  };
}

describe("WorkspaceSessionCatalog", () => {
  it("lists persisted sessions sorted by recency", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const first = createPersistedSession(cwd, sessionDir, {
      title: "Investigate parser",
      prompt: "Investigate parser regression",
      reply: "Parser root cause found",
      thinkingLevel: "high",
    });
    const second = createPersistedSession(cwd, sessionDir, {
      prompt: "Write a regression test",
      reply: "Regression test added",
    });

    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const sessions = await catalog.listSessions();

    expect(sessions.sessions).toHaveLength(2);
    expect(sessions.sessions.map((session) => session.id)).toEqual([second.id, first.id]);
    expect(sessions.sessions.find((session) => session.id === first.id)?.title).toBe(
      "Investigate parser",
    );
  });

  it("creates, opens, renames, forks, and restores sessions across catalog restarts", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const existing = createPersistedSession(cwd, sessionDir, {
      title: "Existing",
      prompt: "Inspect the queue",
      reply: "Queue inspected",
      thinkingLevel: "high",
    });

    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "New Session" }, DEFAULTS);
    expect(created.session.title).toBe("New Session");

    await catalog.renameSession(created.session.id, "Renamed Session");
    const renamedList = await catalog.listSessions();
    expect(renamedList.sessions.find((session) => session.id === created.session.id)?.title).toBe(
      "Renamed Session",
    );

    const opened = await catalog.openSession(existing.id, DEFAULTS.systemPrompt);
    expect(opened.session.title).toBe("Existing");
    expect(opened.messages.some((message) => message.role === "assistant")).toBe(true);
    expect(opened.reasoningEffort).toBe("high");

    const forked = await catalog.forkSession(
      { sessionId: existing.id, title: "Forked Session" },
      DEFAULTS,
    );
    expect(forked.session.title).toBe("Forked Session");
    expect(forked.session.parentSessionId).toBe(existing.id);
    expect(forked.messages.length).toBe(opened.messages.length);

    await catalog.dispose();

    const reopenedCatalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const reopened = await reopenedCatalog.openSession(existing.id, DEFAULTS.systemPrompt);
    expect(reopened.session.title).toBe("Existing");
    expect(reopened.reasoningEffort).toBe("high");
  });

  it("persists a blank created session before the first assistant message", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);

    const created = await catalog.createSession({}, DEFAULTS);
    expect(created.session.title).toBe("New Session");

    await catalog.dispose();

    const reopenedCatalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const sessions = await reopenedCatalog.listSessions();

    expect(sessions.sessions).toHaveLength(1);
    expect(sessions.sessions[0]?.id).toBe(created.session.id);
    expect(sessions.sessions[0]?.title).toBe("New Session");
    expect(sessions.sessions[0]?.messageCount).toBe(0);
  });

  it("blocks deleting the active session while a prompt is streaming", async () => {
    const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
    const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
    const created = await catalog.createSession({ title: "Streaming" }, DEFAULTS);

    (
      catalog as unknown as { activeSession?: { activePrompt: boolean } }
    ).activeSession!.activePrompt = true;

    await expect(catalog.deleteSession(created.session.id, DEFAULTS)).rejects.toThrow(
      "Cannot delete a session while it is streaming.",
    );
  });
});
