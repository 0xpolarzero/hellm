import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

/**
 * Structured Session State POC
 * ============================
 *
 * This file proves the adopted model:
 *
 * - one shared execution model
 * - turns and commands are first-class
 * - every tool call becomes a command
 * - `execute_typescript` is the default generic work surface
 * - workflow, verification, and wait remain native control tools
 * - runtime handlers and bridges record durable facts from real execution
 * - waiting is a status, not a separate execution subsystem
 * - the lifecycle survives save and reload
 *
 * The real implementation should still move to workspace-scoped SQLite.
 * This POC keeps one JSON file because that is the smallest executable proof.
 */

type SessionStatus = "idle" | "running" | "waiting" | "error";
type TurnStatus = "running" | "waiting" | "completed" | "failed";
type ThreadKind = "task" | "workflow" | "verification";
type ThreadStatus = "running" | "waiting" | "completed" | "failed" | "cancelled";
type WaitKind = "user" | "external";
type CommandExecutor =
  | "orchestrator"
  | "execute_typescript"
  | "runtime"
  | "smithers"
  | "verification";
type CommandVisibility = "trace" | "summary" | "surface";
type CommandStatus = "requested" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
type EpisodeKind = "analysis" | "change" | "verification" | "workflow" | "clarification";
type ArtifactKind = "text" | "log" | "json" | "file";
type VerificationKind = "build" | "test" | "lint" | "integration" | "manual" | (string & {});
type VerificationStatus = "passed" | "failed" | "cancelled";
type WorkflowStatus = "running" | "waiting" | "completed" | "failed" | "cancelled";

type WaitState = {
  kind: WaitKind;
  reason: string;
  resumeWhen: string;
  since: string;
};

export type StructuredSessionState = {
  workspace: {
    id: string;
    label: string;
    cwd: string;
  };

  pi: {
    sessionId: string;
    title: string;
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    messageCount: number;
    createdAt: string;
    updatedAt: string;
  };

  session: {
    id: string;
    wait:
      | null
      | ({
          threadId: string;
        } & WaitState);
  };

  turns: Array<{
    id: string;
    requestSummary: string;
    status: TurnStatus;
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  threads: Array<{
    id: string;
    turnId: string;
    parentThreadId: string | null;
    kind: ThreadKind;
    title: string;
    objective: string;
    status: ThreadStatus;
    dependsOnThreadIds: string[];
    wait: WaitState | null;
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  commands: Array<{
    id: string;
    turnId: string;
    threadId: string;
    parentCommandId: string | null;
    toolName: string;
    executor: CommandExecutor;
    visibility: CommandVisibility;
    status: CommandStatus;
    attempts: number;
    title: string;
    summary: string;
    error: string | null;
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  episodes: Array<{
    id: string;
    threadId: string;
    sourceCommandId: string | null;
    kind: EpisodeKind;
    title: string;
    summary: string;
    body: string;
    artifactIds: string[];
    createdAt: string;
  }>;

  verifications: Array<{
    id: string;
    threadId: string;
    commandId: string;
    kind: VerificationKind;
    status: VerificationStatus;
    summary: string;
    command?: string;
    startedAt: string;
    finishedAt: string;
  }>;

  workflows: Array<{
    id: string;
    threadId: string;
    commandId: string;
    smithersRunId: string;
    workflowName: string;
    status: WorkflowStatus;
    summary: string;
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  artifacts: Array<{
    id: string;
    episodeId: string;
    kind: ArtifactKind;
    name: string;
    path?: string;
    content?: string;
    createdAt: string;
  }>;

  events: Array<{
    id: string;
    at: string;
    kind: string;
    subject: {
      kind:
        | "session"
        | "turn"
        | "thread"
        | "command"
        | "episode"
        | "verification"
        | "workflow"
        | "artifact";
      id: string;
    };
    data?: Record<string, unknown>;
  }>;
};

type TurnRecord = StructuredSessionState["turns"][number];
type ThreadRecord = StructuredSessionState["threads"][number];
type CommandRecord = StructuredSessionState["commands"][number];
type EpisodeRecord = StructuredSessionState["episodes"][number];
type VerificationRecord = StructuredSessionState["verifications"][number];
type WorkflowRecord = StructuredSessionState["workflows"][number];
type ArtifactRecord = StructuredSessionState["artifacts"][number];

export type SessionView = {
  title: string;
  sessionStatus: SessionStatus;
  wait: StructuredSessionState["session"]["wait"];
  counts: {
    turns: number;
    threads: number;
    commands: number;
    episodes: number;
    verifications: number;
    workflows: number;
    artifacts: number;
    events: number;
  };
  threadIdsByStatus: {
    running: string[];
    waiting: string[];
    failed: string[];
  };
  visibleThreadIds: string[];
};

export class StructuredSessionPoc {
  private ids = new Map<string, number>();

  private constructor(
    private readonly filePath: string,
    private readonly state: StructuredSessionState,
  ) {}

  static create(input: {
    filePath: string;
    workspace: StructuredSessionState["workspace"];
    pi: StructuredSessionState["pi"];
    sessionId: string;
  }): StructuredSessionPoc {
    mkdirSync(dirname(input.filePath), { recursive: true });

    const poc = new StructuredSessionPoc(input.filePath, {
      workspace: { ...input.workspace },
      pi: { ...input.pi },
      session: {
        id: input.sessionId,
        wait: null,
      },
      turns: [],
      threads: [],
      commands: [],
      episodes: [],
      verifications: [],
      workflows: [],
      artifacts: [],
      events: [],
    });

    poc.save();
    return poc;
  }

  static load(filePath: string): StructuredSessionPoc {
    const state = JSON.parse(readFileSync(filePath, "utf8")) as StructuredSessionState;
    const poc = new StructuredSessionPoc(filePath, state);
    poc.rebuildIdState();
    return poc;
  }

  startTurn(requestSummary: string): TurnRecord {
    const now = this.now();
    const turn: TurnRecord = {
      id: this.nextId("turn"),
      requestSummary,
      status: "running",
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
    };
    this.state.turns.push(turn);
    this.pushEvent("turn.started", "turn", turn.id, { requestSummary });
    this.touchPi(now);
    this.save();
    return structuredClone(turn);
  }

  finishTurn(turnId: string, status: Exclude<TurnStatus, "running">): TurnRecord {
    const turn = this.findTurn(turnId);
    const now = this.now();
    turn.status = status;
    turn.updatedAt = now;
    turn.finishedAt = now;
    this.pushEvent(
      status === "waiting"
        ? "turn.waiting"
        : status === "failed"
          ? "turn.failed"
          : "turn.completed",
      "turn",
      turn.id,
    );
    this.touchPi(now);
    this.save();
    return structuredClone(turn);
  }

  createThread(input: {
    turnId: string;
    parentThreadId?: string | null;
    kind: ThreadKind;
    title: string;
    objective: string;
  }): ThreadRecord {
    const now = this.now();
    const thread: ThreadRecord = {
      id: this.nextId("thread"),
      turnId: input.turnId,
      parentThreadId: input.parentThreadId ?? null,
      kind: input.kind,
      title: input.title,
      objective: input.objective,
      status: "running",
      dependsOnThreadIds: [],
      wait: null,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
    };
    this.state.threads.push(thread);
    this.pushEvent("thread.created", "thread", thread.id, {
      turnId: thread.turnId,
      kind: thread.kind,
      parentThreadId: thread.parentThreadId,
    });
    this.touchPi(now);
    this.save();
    return structuredClone(thread);
  }

  updateThread(
    threadId: string,
    input: {
      status?: ThreadStatus;
      dependsOnThreadIds?: string[];
      wait?: WaitState | null;
      title?: string;
      objective?: string;
    },
  ): ThreadRecord {
    const thread = this.findThread(threadId);
    const now = this.now();

    if (input.title !== undefined) {
      thread.title = input.title;
    }
    if (input.objective !== undefined) {
      thread.objective = input.objective;
    }
    if (input.dependsOnThreadIds !== undefined) {
      thread.dependsOnThreadIds = [...input.dependsOnThreadIds];
    }
    if (input.wait !== undefined) {
      thread.wait = input.wait === null ? null : { ...input.wait };
    }
    if (input.status !== undefined) {
      thread.status = input.status;
    }

    if (thread.wait && thread.dependsOnThreadIds.length > 0) {
      throw new Error(
        `Thread ${thread.id} cannot wait on threads and user/external input at the same time.`,
      );
    }

    if (thread.status !== "waiting") {
      thread.dependsOnThreadIds = [];
      thread.wait = null;
      if (this.state.session.wait?.threadId === thread.id) {
        this.state.session.wait = null;
        this.pushEvent("session.wait.cleared", "session", this.state.session.id, {
          threadId: thread.id,
        });
      }
    }

    thread.updatedAt = now;
    if (
      thread.status === "completed" ||
      thread.status === "failed" ||
      thread.status === "cancelled"
    ) {
      thread.finishedAt = now;
    }

    this.pushEvent(
      thread.status === "completed" || thread.status === "failed" || thread.status === "cancelled"
        ? "thread.finished"
        : "thread.updated",
      "thread",
      thread.id,
      {
        status: thread.status,
        dependsOnThreadIds: thread.dependsOnThreadIds,
        wait: thread.wait,
      },
    );
    this.touchPi(now);
    this.save();
    return structuredClone(thread);
  }

  setSessionWait(input: {
    threadId: string;
    kind: WaitKind;
    reason: string;
    resumeWhen: string;
  }): StructuredSessionState["session"]["wait"] {
    const thread = this.findThread(input.threadId);
    if (thread.status !== "waiting" || !thread.wait) {
      throw new Error(
        `Session wait requires a waiting thread with thread.wait details: ${thread.id}`,
      );
    }
    if (
      thread.wait.kind !== input.kind ||
      thread.wait.reason !== input.reason ||
      thread.wait.resumeWhen !== input.resumeWhen
    ) {
      throw new Error(`Session wait must match the owning thread wait details: ${thread.id}`);
    }
    if (
      this.state.threads.some(
        (candidate) => candidate.id !== thread.id && candidate.status === "running",
      )
    ) {
      throw new Error("Session wait is only allowed when no other runnable work remains.");
    }

    const now = this.now();
    const wait = {
      threadId: input.threadId,
      kind: input.kind,
      reason: input.reason,
      resumeWhen: input.resumeWhen,
      since: now,
    } satisfies NonNullable<StructuredSessionState["session"]["wait"]>;
    this.state.session.wait = wait;
    this.pushEvent("session.wait.started", "session", this.state.session.id, wait);
    this.touchPi(now);
    this.save();
    return structuredClone(wait);
  }

  clearSessionWait(): void {
    if (!this.state.session.wait) {
      return;
    }
    const wait = this.state.session.wait;
    const now = this.now();
    this.state.session.wait = null;
    this.pushEvent("session.wait.cleared", "session", this.state.session.id, {
      threadId: wait.threadId,
      kind: wait.kind,
    });
    this.touchPi(now);
    this.save();
  }

  createCommand(input: {
    turnId: string;
    threadId: string;
    parentCommandId?: string | null;
    toolName: string;
    executor: CommandExecutor;
    visibility: CommandVisibility;
    title: string;
    summary: string;
  }): CommandRecord {
    const now = this.now();
    const command: CommandRecord = {
      id: this.nextId("command"),
      turnId: input.turnId,
      threadId: input.threadId,
      parentCommandId: input.parentCommandId ?? null,
      toolName: input.toolName,
      executor: input.executor,
      visibility: input.visibility,
      status: "requested",
      attempts: 1,
      title: input.title,
      summary: input.summary,
      error: null,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
    };
    this.state.commands.push(command);
    this.pushEvent("command.requested", "command", command.id, {
      toolName: command.toolName,
      threadId: command.threadId,
      parentCommandId: command.parentCommandId,
    });
    this.touchPi(now);
    this.save();
    return structuredClone(command);
  }

  bumpCommandAttempt(commandId: string): CommandRecord {
    const command = this.findCommand(commandId);
    const now = this.now();
    command.attempts += 1;
    command.updatedAt = now;
    command.summary = `${command.summary} Retry attempt ${command.attempts}.`;
    this.pushEvent("command.started", "command", command.id, {
      attempts: command.attempts,
      retry: true,
    });
    this.touchPi(now);
    this.save();
    return structuredClone(command);
  }

  startCommand(commandId: string): CommandRecord {
    const command = this.findCommand(commandId);
    const now = this.now();
    command.status = "running";
    command.updatedAt = now;
    this.pushEvent("command.started", "command", command.id, { toolName: command.toolName });
    this.touchPi(now);
    this.save();
    return structuredClone(command);
  }

  finishCommand(
    commandId: string,
    input: {
      status: Exclude<CommandStatus, "requested" | "running">;
      summary?: string;
      error?: string | null;
    },
  ): CommandRecord {
    const command = this.findCommand(commandId);
    const now = this.now();
    command.status = input.status;
    command.updatedAt = now;
    command.summary = input.summary ?? command.summary;
    command.error = input.error ?? null;
    command.finishedAt = input.status === "waiting" ? null : now;

    this.pushEvent(
      input.status === "waiting" ? "command.waiting" : "command.finished",
      "command",
      command.id,
      {
        status: input.status,
        error: command.error,
      },
    );
    this.touchPi(now);
    this.save();
    return structuredClone(command);
  }

  createEpisode(input: {
    threadId: string;
    sourceCommandId?: string | null;
    kind: EpisodeKind;
    title: string;
    summary: string;
    body: string;
  }): EpisodeRecord {
    const now = this.now();
    const episode: EpisodeRecord = {
      id: this.nextId("episode"),
      threadId: input.threadId,
      sourceCommandId: input.sourceCommandId ?? null,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      body: input.body,
      artifactIds: [],
      createdAt: now,
    };
    this.state.episodes.push(episode);
    this.pushEvent("episode.created", "episode", episode.id, {
      threadId: episode.threadId,
      kind: episode.kind,
    });
    this.touchPi(now);
    this.save();
    return structuredClone(episode);
  }

  createArtifact(input: {
    episodeId: string;
    kind: ArtifactKind;
    name: string;
    path?: string;
    content?: string;
  }): ArtifactRecord {
    const episode = this.findEpisode(input.episodeId);
    const now = this.now();
    const artifact: ArtifactRecord = {
      id: this.nextId("artifact"),
      episodeId: input.episodeId,
      kind: input.kind,
      name: input.name,
      path: input.path,
      content: input.content,
      createdAt: now,
    };
    this.state.artifacts.push(artifact);
    episode.artifactIds.push(artifact.id);
    this.pushEvent("artifact.created", "artifact", artifact.id, {
      episodeId: artifact.episodeId,
      kind: artifact.kind,
    });
    this.touchPi(now);
    this.save();
    return structuredClone(artifact);
  }

  recordVerification(input: {
    threadId: string;
    commandId: string;
    kind: VerificationKind;
    status: VerificationStatus;
    summary: string;
    command?: string;
  }): VerificationRecord {
    const now = this.now();
    const verification: VerificationRecord = {
      id: this.nextId("verification"),
      threadId: input.threadId,
      commandId: input.commandId,
      kind: input.kind,
      status: input.status,
      summary: input.summary,
      command: input.command,
      startedAt: now,
      finishedAt: now,
    };
    this.state.verifications.push(verification);
    this.pushEvent("verification.recorded", "verification", verification.id, {
      threadId: verification.threadId,
      status: verification.status,
    });
    this.touchPi(now);
    this.save();
    return structuredClone(verification);
  }

  recordWorkflow(input: {
    threadId: string;
    commandId: string;
    smithersRunId: string;
    workflowName: string;
    status: WorkflowStatus;
    summary: string;
  }): WorkflowRecord {
    const now = this.now();
    const workflow: WorkflowRecord = {
      id: this.nextId("workflow"),
      threadId: input.threadId,
      commandId: input.commandId,
      smithersRunId: input.smithersRunId,
      workflowName: input.workflowName,
      status: input.status,
      summary: input.summary,
      startedAt: now,
      updatedAt: now,
      finishedAt: input.status === "running" || input.status === "waiting" ? null : now,
    };
    this.state.workflows.push(workflow);
    this.pushEvent("workflow.recorded", "workflow", workflow.id, {
      threadId: workflow.threadId,
      status: workflow.status,
      smithersRunId: workflow.smithersRunId,
    });
    this.touchPi(now);
    this.save();
    return structuredClone(workflow);
  }

  updateWorkflow(
    workflowId: string,
    input: {
      status: WorkflowStatus;
      summary: string;
    },
  ): WorkflowRecord {
    const workflow = this.findWorkflow(workflowId);
    const now = this.now();
    workflow.status = input.status;
    workflow.summary = input.summary;
    workflow.updatedAt = now;
    if (input.status === "completed" || input.status === "failed" || input.status === "cancelled") {
      workflow.finishedAt = now;
    }
    this.pushEvent("workflow.updated", "workflow", workflow.id, {
      status: workflow.status,
      summary: workflow.summary,
    });
    this.touchPi(now);
    this.save();
    return structuredClone(workflow);
  }

  getSessionView(): SessionView {
    return {
      title: this.state.pi.title,
      sessionStatus: this.deriveSessionStatus(),
      wait: structuredClone(this.state.session.wait),
      counts: {
        turns: this.state.turns.length,
        threads: this.state.threads.length,
        commands: this.state.commands.length,
        episodes: this.state.episodes.length,
        verifications: this.state.verifications.length,
        workflows: this.state.workflows.length,
        artifacts: this.state.artifacts.length,
        events: this.state.events.length,
      },
      threadIdsByStatus: {
        running: this.state.threads
          .filter((thread) => thread.status === "running")
          .map((thread) => thread.id),
        waiting: this.state.threads
          .filter((thread) => thread.status === "waiting")
          .map((thread) => thread.id),
        failed: this.state.threads
          .filter((thread) => thread.status === "failed")
          .map((thread) => thread.id),
      },
      visibleThreadIds: [...this.state.threads]
        .toSorted((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
        .map((thread) => thread.id),
    };
  }

  getState(): StructuredSessionState {
    return structuredClone(this.state);
  }

  private findTurn(turnId: string): TurnRecord {
    const turn = this.state.turns.find((candidate) => candidate.id === turnId);
    if (!turn) {
      throw new Error(`Unknown turn: ${turnId}`);
    }
    return turn;
  }

  private findThread(threadId: string): ThreadRecord {
    const thread = this.state.threads.find((candidate) => candidate.id === threadId);
    if (!thread) {
      throw new Error(`Unknown thread: ${threadId}`);
    }
    return thread;
  }

  private findCommand(commandId: string): CommandRecord {
    const command = this.state.commands.find((candidate) => candidate.id === commandId);
    if (!command) {
      throw new Error(`Unknown command: ${commandId}`);
    }
    return command;
  }

  private findEpisode(episodeId: string): EpisodeRecord {
    const episode = this.state.episodes.find((candidate) => candidate.id === episodeId);
    if (!episode) {
      throw new Error(`Unknown episode: ${episodeId}`);
    }
    return episode;
  }

  private findWorkflow(workflowId: string): WorkflowRecord {
    const workflow = this.state.workflows.find((candidate) => candidate.id === workflowId);
    if (!workflow) {
      throw new Error(`Unknown workflow: ${workflowId}`);
    }
    return workflow;
  }

  private deriveSessionStatus(): SessionStatus {
    if (this.state.session.wait) {
      return "waiting";
    }

    if (this.state.threads.some((thread) => thread.status === "running")) {
      return "running";
    }

    if (
      this.state.threads.some(
        (thread) => thread.status === "waiting" && thread.dependsOnThreadIds.length > 0,
      )
    ) {
      return "running";
    }

    const latestFailure = [
      ...this.state.turns.filter((turn) => turn.status === "failed").map((turn) => turn.updatedAt),
      ...this.state.threads
        .filter((thread) => thread.status === "failed")
        .map((thread) => thread.updatedAt),
    ]
      .toSorted()
      .pop();

    if (latestFailure) {
      return "error";
    }

    return "idle";
  }

  private pushEvent(
    kind: string,
    subjectKind: StructuredSessionState["events"][number]["subject"]["kind"],
    subjectId: string,
    data?: Record<string, unknown>,
  ): void {
    this.state.events.push({
      id: this.nextId("event"),
      at: this.now(),
      kind,
      subject: {
        kind: subjectKind,
        id: subjectId,
      },
      data,
    });
  }

  private touchPi(at: string): void {
    this.state.pi.updatedAt = at;
  }

  private save(): void {
    writeFileSync(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }

  private nextId(prefix: string): string {
    const next = (this.ids.get(prefix) ?? 0) + 1;
    this.ids.set(prefix, next);
    return `${prefix}-${next}`;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private rebuildIdState(): void {
    const prefixes = [
      ...this.state.turns.map((record) => record.id),
      ...this.state.threads.map((record) => record.id),
      ...this.state.commands.map((record) => record.id),
      ...this.state.episodes.map((record) => record.id),
      ...this.state.verifications.map((record) => record.id),
      ...this.state.workflows.map((record) => record.id),
      ...this.state.artifacts.map((record) => record.id),
      ...this.state.events.map((record) => record.id),
    ];

    for (const id of prefixes) {
      const match = /^([a-z-]+)-(\d+)$/.exec(id);
      if (!match) {
        continue;
      }
      const [, prefix, rawValue] = match;
      const value = Number(rawValue);
      const current = this.ids.get(prefix) ?? 0;
      if (value > current) {
        this.ids.set(prefix, value);
      }
    }
  }
}

function runPoc(): void {
  const root = mkdtempSync(join(tmpdir(), "svvy-structured-state-"));
  const filePath = join(root, "structured-session-state.json");

  const poc = StructuredSessionPoc.create({
    filePath,
    sessionId: "session-1",
    workspace: {
      id: "workspace-1",
      label: "svvy",
      cwd: "/repo/svvy",
    },
    pi: {
      sessionId: "pi-session-1",
      title: "Refactor docs around the command model",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "high",
      messageCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

  const turn1 = poc.startTurn("Read the product docs and explain the new command-centered model.");
  const task1 = poc.createThread({
    turnId: turn1.id,
    kind: "task",
    title: "Inspect the current docs",
    objective: "Review the PRD, state spec, and execution model before rewriting them.",
  });

  const executeTypescript = poc.createCommand({
    turnId: turn1.id,
    threadId: task1.id,
    toolName: "execute_typescript",
    executor: "orchestrator",
    visibility: "summary",
    title: "Inspect repo docs",
    summary: "Run a short TypeScript program to inspect the docs surface.",
  });
  poc.startCommand(executeTypescript.id);

  const searchDocs = poc.createCommand({
    turnId: turn1.id,
    threadId: task1.id,
    parentCommandId: executeTypescript.id,
    toolName: "repo.searchText",
    executor: "execute_typescript",
    visibility: "trace",
    title: "Search docs",
    summary: "Find stale references to direct paths, projections, and external_*.",
  });
  poc.startCommand(searchDocs.id);
  poc.finishCommand(searchDocs.id, {
    status: "succeeded",
    summary: "Found the old path language and flat external_* capability references.",
  });

  const readPrd = poc.createCommand({
    turnId: turn1.id,
    threadId: task1.id,
    parentCommandId: executeTypescript.id,
    toolName: "repo.readFile",
    executor: "execute_typescript",
    visibility: "trace",
    title: "Read PRD",
    summary: "Load docs/prd.md for review.",
  });
  poc.startCommand(readPrd.id);
  poc.finishCommand(readPrd.id, {
    status: "succeeded",
    summary: "Loaded the PRD and identified the old four-path framing.",
  });

  const writeResearchArtifact = poc.createCommand({
    turnId: turn1.id,
    threadId: task1.id,
    parentCommandId: executeTypescript.id,
    toolName: "artifact.writeText",
    executor: "execute_typescript",
    visibility: "summary",
    title: "Write research notes",
    summary: "Persist a compact note with the architecture mismatches.",
  });
  poc.startCommand(writeResearchArtifact.id);
  poc.finishCommand(writeResearchArtifact.id, {
    status: "succeeded",
    summary: "Wrote a compact note about the outdated terminology and state model drift.",
  });

  poc.finishCommand(executeTypescript.id, {
    status: "succeeded",
    summary: "Completed generic inspection through execute_typescript and nested tools.* calls.",
  });

  const analysisEpisode = poc.createEpisode({
    threadId: task1.id,
    sourceCommandId: executeTypescript.id,
    kind: "analysis",
    title: "Current model audit",
    summary: "The docs still describe multiple execution paths and external_* capabilities.",
    body: "The design should move to one command model where execute_typescript handles ordinary work and native control tools handle workflow, verification, and wait.",
  });
  poc.createArtifact({
    episodeId: analysisEpisode.id,
    kind: "text",
    name: "architecture-audit.md",
    content:
      "Replace four-path language with a single command pipeline and tools.* capability model.",
  });
  poc.updateThread(task1.id, { status: "completed" });
  poc.finishTurn(turn1.id, "completed");

  const turn2 = poc.startTurn(
    "Rewrite the PRD and the structured-state docs to match the adopted model.",
  );
  const task2 = poc.createThread({
    turnId: turn2.id,
    kind: "task",
    title: "Coordinate the rewrite",
    objective: "Drive the doc rewrite, workflow delegation, verification, and final wait state.",
  });

  const workflowThread = poc.createThread({
    turnId: turn2.id,
    parentThreadId: task2.id,
    kind: "workflow",
    title: "Rewrite the product docs",
    objective:
      "Run a delegated workflow that rewrites the PRD, specs, and POC around the command model.",
  });
  poc.updateThread(task2.id, {
    status: "waiting",
    dependsOnThreadIds: [workflowThread.id],
  });

  const workflowStart = poc.createCommand({
    turnId: turn2.id,
    threadId: workflowThread.id,
    toolName: "workflow.start",
    executor: "smithers",
    visibility: "surface",
    title: "Start delegated workflow",
    summary: "Launch the real delegated workflow in Smithers.",
  });
  poc.startCommand(workflowStart.id);
  const workflowRecord = poc.recordWorkflow({
    threadId: workflowThread.id,
    commandId: workflowStart.id,
    smithersRunId: "smithers-run-123",
    workflowName: "rewrite-docs-around-command-model",
    status: "running",
    summary: "Milestone 1: replace path language with the command-centered model.",
  });
  poc.finishCommand(workflowStart.id, {
    status: "succeeded",
    summary: "Started the Smithers workflow and recorded the top-level workflow record.",
  });

  poc.updateWorkflow(workflowRecord.id, {
    status: "completed",
    summary: "Workflow completed the rewrite and returned updated docs plus a reference POC.",
  });
  const workflowEpisode = poc.createEpisode({
    threadId: workflowThread.id,
    sourceCommandId: workflowStart.id,
    kind: "workflow",
    title: "Docs rewrite completed",
    summary: "The delegated workflow rewrote the PRD, specs, and POC around one command system.",
    body: "The workflow removed external_* naming, restored episodes as durable records, introduced commands as first-class state, and made waiting a shared status instead of a separate subsystem.",
  });
  poc.createArtifact({
    episodeId: workflowEpisode.id,
    kind: "file",
    name: "docs-rewrite.patch",
    path: "/repo/svvy/docs-rewrite.patch",
  });
  poc.updateThread(workflowThread.id, { status: "completed" });
  poc.updateThread(task2.id, { status: "running" });

  const verificationThread = poc.createThread({
    turnId: turn2.id,
    parentThreadId: task2.id,
    kind: "verification",
    title: "Verify the rewritten docs",
    objective: "Run the docs and POC verification checks before finalizing the turn.",
  });
  poc.updateThread(task2.id, {
    status: "waiting",
    dependsOnThreadIds: [verificationThread.id],
  });

  const verificationRun = poc.createCommand({
    turnId: turn2.id,
    threadId: verificationThread.id,
    toolName: "verification.run",
    executor: "verification",
    visibility: "surface",
    title: "Run verification",
    summary: "Run the POC and validate the rewritten docs surface.",
  });
  poc.startCommand(verificationRun.id);
  poc.recordVerification({
    threadId: verificationThread.id,
    commandId: verificationRun.id,
    kind: "test",
    status: "passed",
    summary: "The POC lifecycle executed and the rewritten docs stayed internally consistent.",
    command: "bun docs/pocs/structured-session-state.poc.ts",
  });
  poc.finishCommand(verificationRun.id, {
    status: "succeeded",
    summary: "Verification passed and the resulting state model matched the rewritten docs.",
  });
  const verificationEpisode = poc.createEpisode({
    threadId: verificationThread.id,
    sourceCommandId: verificationRun.id,
    kind: "verification",
    title: "Docs verification passed",
    summary: "The new model is internally consistent across PRD, specs, and POC.",
    body: "The reference POC exercised turns, commands, workflow, verification, and wait state without relying on transcript-derived product truth.",
  });
  poc.createArtifact({
    episodeId: verificationEpisode.id,
    kind: "log",
    name: "poc-run.log",
    content: "Structured session state POC completed successfully.",
  });
  poc.updateThread(verificationThread.id, { status: "completed" });
  poc.updateThread(task2.id, { status: "running" });

  const waitCommand = poc.createCommand({
    turnId: turn2.id,
    threadId: task2.id,
    toolName: "wait",
    executor: "runtime",
    visibility: "surface",
    title: "Wait for user review",
    summary: "Pause for final user review of the rewritten design before code refactoring starts.",
  });
  poc.startCommand(waitCommand.id);
  poc.updateThread(task2.id, {
    status: "waiting",
    wait: {
      kind: "user",
      reason:
        "Need explicit user review of the rewritten architecture docs before refactoring runtime code.",
      resumeWhen: "The user confirms the rewritten docs and requests the runtime refactor.",
      since: new Date().toISOString(),
    },
  });
  poc.setSessionWait({
    threadId: task2.id,
    kind: "user",
    reason:
      "Need explicit user review of the rewritten architecture docs before refactoring runtime code.",
    resumeWhen: "The user confirms the rewritten docs and requests the runtime refactor.",
  });
  poc.finishCommand(waitCommand.id, {
    status: "waiting",
    summary: "The session is now waiting on user review of the rewritten design.",
  });
  poc.createEpisode({
    threadId: task2.id,
    sourceCommandId: waitCommand.id,
    kind: "clarification",
    title: "Waiting for review",
    summary: "The rewritten docs are ready for review before runtime implementation starts.",
    body: "The next step is code refactoring, but the active frontier is intentionally paused until the user reviews the updated PRD, specs, and reference POC.",
  });
  poc.finishTurn(turn2.id, "waiting");

  const reloaded = StructuredSessionPoc.load(filePath);
  const sessionView = reloaded.getSessionView();
  const snapshot = reloaded.getState();

  console.log("\nStructured Session State POC\n");
  console.log(`State file: ${filePath}`);
  console.log(`Session title: ${sessionView.title}`);
  console.log(`Session status: ${sessionView.sessionStatus}`);
  console.log(`Visible thread ids: ${sessionView.visibleThreadIds.join(", ")}`);
  console.log(`Counts: ${JSON.stringify(sessionView.counts, null, 2)}`);
  console.log(`Current wait: ${JSON.stringify(sessionView.wait, null, 2)}`);
  console.log(
    `Workflow summaries: ${snapshot.workflows.map((workflow) => `${workflow.workflowName}=${workflow.status}`).join(", ")}`,
  );
  console.log(
    `Verification summaries: ${snapshot.verifications.map((verification) => `${verification.kind}=${verification.status}`).join(", ")}`,
  );
  console.log(`Last event: ${snapshot.events.at(-1)?.kind ?? "none"}`);
  console.log(`Saved file basename: ${basename(filePath)}`);
}

runPoc();
