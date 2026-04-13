import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

/**
 * Structured Session State POC
 * ============================
 *
 * This is one executable file that proves the whole idea.
 *
 * Read it in this order:
 * 1. `StructuredSessionState`: the whole proposed state model in one place.
 * 2. `StructuredSessionPoc`: the tiny runtime that writes and reads that state.
 * 3. `runPoc()`: the full lifecycle the product needs to support.
 *
 * What this file is trying to prove:
 * - `pi` should stay the source of truth for transcript history.
 * - `svvy` should own explicit product state above that transcript.
 * - that product state should make threads, results, verification, workflows,
 *   and waiting state directly queryable.
 * - the lifecycle should survive save + reload.
 *
 * This POC uses one JSON file because that is the smallest way to make the
 * lifecycle executable in one file. The real implementation should still move
 * to workspace-scoped SQLite.
 */

type SessionStatus = "idle" | "running" | "waiting" | "error";

/**
 * Thread kind answers:
 * "what kind of workstream is this?"
 */
type ThreadKind = "direct" | "verification" | "workflow";

type ThreadStatus = "running" | "completed" | "failed" | "waiting";

/**
 * Result kind answers:
 * "what kind of final result did this thread produce?"
 */
type ThreadResultKind =
  | "analysis-summary"
  | "change-summary"
  | "verification-summary"
  | "workflow-summary"
  | "clarification-summary";

/**
 * Verification kind is intentionally open-ended.
 *
 * We keep a few useful built-in kinds for clarity and autocomplete, but allow
 * any string because real repos may have domain-specific checks that do not fit
 * a small closed enum.
 */
type VerificationKind = "build" | "test" | "lint" | "integration" | "manual" | (string & {});

type VerificationStatus = "passed" | "failed" | "cancelled";
type WorkflowStatus = "running" | "completed" | "failed" | "waiting";

/**
 * This single type is the core of the whole proposal.
 *
 * If you understand this shape, you understand the product model.
 *
 * The main idea:
 * - `pi` still owns raw conversation history.
 * - `svvy` owns the structured product state below `session`.
 */
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
    status: SessionStatus;
    createdAt: string;
    updatedAt: string;
  };

  session: {
    /**
     * Everything else that can be derived from arrays should stay derived.
     */
    waitingOn: null | {
      threadId: string;
      reason: string;
      resumeWhen: string;
      since: string;
    };
  };

  threads: Array<{
    id: string;
    kind: ThreadKind;
    objective: string;
    status: ThreadStatus;
    result: null | {
      kind: ThreadResultKind;
      summary: string;
      body: string;
      createdAt: string;
    };
    blockedReason: string | null;
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  verifications: Array<{
    id: string;
    threadId: string;
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
    smithersRunId: string;
    workflowName: string;
    status: WorkflowStatus;
    summary: string;
    startedAt: string;
    updatedAt: string;
    finishedAt: string | null;
  }>;

  events: Array<{
    id: string;
    at: string;
    kind:
      | "thread-started"
      | "thread-status-changed"
      | "thread-result-created"
      | "verification-finished"
      | "workflow-started"
      | "workflow-status-changed"
      | "session-waiting-started"
      | "session-waiting-ended";
    threadId?: string;
  }>;
};

type ThreadRecord = StructuredSessionState["threads"][number];
type ThreadResultRecord = NonNullable<ThreadRecord["result"]>;
type VerificationRecord = StructuredSessionState["verifications"][number];
type WorkflowRecord = StructuredSessionState["workflows"][number];

/**
 * These are selector-style reads, not raw storage reads.
 *
 * This matters because the real product should query "what the UI needs" rather
 * than forcing the UI to understand storage layout.
 */
export type SessionView = {
  title: string;
  sessionStatus: SessionStatus;
  waitingOn: StructuredSessionState["session"]["waitingOn"];
  counts: {
    threads: number;
    results: number;
    verifications: number;
    workflows: number;
    events: number;
  };
  threadIdsByStatus: {
    running: string[];
    waiting: string[];
    failed: string[];
  };
};

/**
 * Small runtime
 * -------------
 *
 * This class is intentionally tiny. It only exists to prove the lifecycle.
 *
 * The responsibilities are simple:
 * - own writes
 * - persist after each write
 * - expose a few selector reads
 * - reload from disk safely
 */
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
  }): StructuredSessionPoc {
    mkdirSync(dirname(input.filePath), { recursive: true });

    const poc = new StructuredSessionPoc(input.filePath, {
      workspace: { ...input.workspace },
      pi: { ...input.pi },
      session: {
        waitingOn: null,
      },
      threads: [],
      verifications: [],
      workflows: [],
      events: [],
    });

    poc.save();
    return poc;
  }

  static load(filePath: string): StructuredSessionPoc {
    const state = JSON.parse(readFileSync(filePath, "utf8")) as StructuredSessionState;
    const poc = new StructuredSessionPoc(filePath, state);
    poc.rebuildIdCounters();
    return poc;
  }

  startThread(input: { kind: ThreadKind; objective: string }): ThreadRecord {
    const timestamp = new Date().toISOString();
    const thread: ThreadRecord = {
      id: this.id("thread"),
      kind: input.kind,
      objective: input.objective,
      status: "running",
      result: null,
      blockedReason: null,
      startedAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null,
    };

    this.state.threads.push(thread);
    this.state.pi.updatedAt = timestamp;
    this.event("thread-started", thread.id);
    this.save();
    return thread;
  }

  updateThread(input: {
    threadId: string;
    status: ThreadStatus;
    blockedReason?: string | null;
  }): ThreadRecord {
    const thread = this.mustFindThread(input.threadId);
    const timestamp = new Date().toISOString();

    thread.status = input.status;
    thread.blockedReason = input.blockedReason ?? thread.blockedReason;
    thread.updatedAt = timestamp;
    thread.finishedAt =
      input.status === "completed" || input.status === "failed" ? timestamp : null;

    if (input.status !== "waiting" && this.state.session.waitingOn?.threadId === thread.id) {
      this.state.session.waitingOn = null;
      this.event("session-waiting-ended", thread.id);
    }

    this.state.pi.updatedAt = timestamp;

    this.event("thread-status-changed", thread.id);
    this.save();
    return thread;
  }

  setThreadResult(input: {
    threadId: string;
    kind: ThreadResultKind;
    summary: string;
    body: string;
  }): ThreadResultRecord {
    const thread = this.mustFindThread(input.threadId);
    if (thread.result) {
      throw new Error(`Thread already has a result: ${input.threadId}`);
    }

    const result: ThreadResultRecord = {
      kind: input.kind,
      summary: input.summary,
      body: input.body,
      createdAt: new Date().toISOString(),
    };

    thread.result = result;
    thread.updatedAt = result.createdAt;
    this.state.pi.updatedAt = result.createdAt;
    this.event("thread-result-created", input.threadId);
    this.save();
    return result;
  }

  recordVerification(input: {
    threadId: string;
    kind: VerificationKind;
    status: VerificationStatus;
    summary: string;
    command?: string;
  }): VerificationRecord {
    this.mustFindThread(input.threadId);

    const timestamp = new Date().toISOString();
    const verification: VerificationRecord = {
      id: this.id("verification"),
      threadId: input.threadId,
      kind: input.kind,
      status: input.status,
      summary: input.summary,
      command: input.command,
      startedAt: timestamp,
      finishedAt: timestamp,
    };

    this.state.verifications.push(verification);
    this.state.pi.updatedAt = timestamp;
    this.event("verification-finished", input.threadId);
    this.save();
    return verification;
  }

  startWorkflow(input: {
    threadId: string;
    smithersRunId: string;
    workflowName: string;
    summary: string;
  }): WorkflowRecord {
    this.mustFindThread(input.threadId);
    if (this.state.workflows.some((workflow) => workflow.threadId === input.threadId)) {
      throw new Error(`Thread already has a workflow: ${input.threadId}`);
    }

    const timestamp = new Date().toISOString();
    const workflow: WorkflowRecord = {
      id: this.id("workflow"),
      threadId: input.threadId,
      smithersRunId: input.smithersRunId,
      workflowName: input.workflowName,
      status: "running",
      summary: input.summary,
      startedAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null,
    };

    this.state.workflows.push(workflow);
    this.state.pi.updatedAt = timestamp;
    this.event("workflow-started", input.threadId);
    this.save();
    return workflow;
  }

  updateWorkflow(input: {
    workflowId: string;
    status: WorkflowStatus;
    summary: string;
  }): WorkflowRecord {
    const workflow = this.mustFindWorkflow(input.workflowId);
    const timestamp = new Date().toISOString();

    workflow.status = input.status;
    workflow.summary = input.summary;
    workflow.updatedAt = timestamp;
    workflow.finishedAt =
      input.status === "completed" || input.status === "failed" ? timestamp : null;

    this.state.pi.updatedAt = timestamp;
    this.event("workflow-status-changed", workflow.threadId);
    this.save();
    return workflow;
  }

  setWaitingState(input: { threadId: string; reason: string; resumeWhen: string }): void {
    const timestamp = new Date().toISOString();
    this.state.session.waitingOn = {
      threadId: input.threadId,
      reason: input.reason,
      resumeWhen: input.resumeWhen,
      since: timestamp,
    };
    this.state.pi.status = "waiting";
    this.state.pi.updatedAt = timestamp;
    this.event("session-waiting-started", input.threadId);
    this.save();
  }

  /**
   * Selector reads
   */
  getSessionView(): SessionView {
    return {
      title: this.state.pi.title,
      sessionStatus: this.state.pi.status,
      waitingOn: structuredClone(this.state.session.waitingOn),
      counts: {
        threads: this.state.threads.length,
        results: this.state.threads.filter((thread) => thread.result !== null).length,
        verifications: this.state.verifications.length,
        workflows: this.state.workflows.length,
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
    };
  }

  getThreadList(): ThreadRecord[] {
    return structuredClone(this.state.threads);
  }

  getThreadDetail(threadId: string) {
    const thread = this.mustFindThread(threadId);
    const verifications = this.state.verifications.filter(
      (verification) => verification.threadId === threadId,
    );
    const workflow = this.state.workflows.find((item) => item.threadId === threadId) ?? null;

    return {
      thread: structuredClone(thread),
      verifications: structuredClone(verifications),
      workflow: structuredClone(workflow),
    };
  }

  getPersistedFilePath(): string {
    return this.filePath;
  }

  /**
   * Internals
   */
  private save(): void {
    this.refreshSessionStatus();
    writeFileSync(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  private event(kind: StructuredSessionState["events"][number]["kind"], threadId?: string): void {
    this.state.events.push({
      id: this.id("event"),
      at: new Date().toISOString(),
      kind,
      threadId,
    });
  }

  private refreshSessionStatus(): void {
    if (this.state.session.waitingOn) {
      this.state.pi.status = "waiting";
      return;
    }

    if (this.state.threads.some((thread) => thread.status === "running")) {
      this.state.pi.status = "running";
      return;
    }

    const latestUpdatedThread = this.state.threads.toSorted((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )[0];

    if (latestUpdatedThread?.status === "failed") {
      this.state.pi.status = "error";
      return;
    }

    this.state.pi.status = "idle";
  }

  private id(prefix: string): string {
    const next = (this.ids.get(prefix) ?? 0) + 1;
    this.ids.set(prefix, next);
    return `${prefix}-${String(next).padStart(3, "0")}`;
  }

  private rebuildIdCounters(): void {
    const ids = [
      ...this.state.threads.map((item) => item.id),
      ...this.state.verifications.map((item) => item.id),
      ...this.state.workflows.map((item) => item.id),
      ...this.state.events.map((item) => item.id),
    ];

    for (const value of ids) {
      const match = value.match(/^([a-z]+)-(\d+)$/);
      if (!match) continue;
      const prefix = match[1];
      const number = Number(match[2]);
      this.ids.set(prefix, Math.max(this.ids.get(prefix) ?? 0, number));
    }
  }

  private mustFindThread(threadId: string): ThreadRecord {
    const thread = this.state.threads.find((item) => item.id === threadId);
    if (!thread) throw new Error(`Unknown thread: ${threadId}`);
    return thread;
  }

  private mustFindWorkflow(workflowId: string): WorkflowRecord {
    const workflow = this.state.workflows.find((item) => item.id === workflowId);
    if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
    return workflow;
  }
}

/**
 * End-to-end proof
 * ----------------
 *
 * This is the full lifecycle in the exact order a first-time reader should
 * understand it.
 */
export function runPoc() {
  const folder = mkdtempSync(join(tmpdir(), "svvy-structured-session-state-"));
  const filePath = join(folder, "structured-session-state.poc.json");
  const cwd = process.cwd();
  const workspaceLabel = basename(cwd) || "workspace";

  /**
   * Step 1:
   * Start with a normal `pi` session mirror. No structured session records
   * have been written yet.
   */
  const poc = StructuredSessionPoc.create({
    filePath,
    workspace: {
      id: cwd,
      label: workspaceLabel,
      cwd,
    },
    pi: {
      sessionId: "session-structured-review",
      title: "Build a runtime structured session state POC",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "high",
      messageCount: 18,
      status: "idle",
      createdAt: "2026-04-13T08:00:00.000Z",
      updatedAt: "2026-04-13T08:00:00.000Z",
    },
  });

  const beforeStructuredState = poc.getSessionView();

  /**
   * Step 2:
   * Run a direct path and capture one durable result for the thread.
   */
  const directThread = poc.startThread({
    kind: "direct",
    objective: "Inspect the state model and define the minimum structured contract.",
  });

  poc.setThreadResult({
    threadId: directThread.id,
    kind: "analysis-summary",
    summary: "Captured the minimum structured state contract as the thread result.",
    body: "The direct analysis concluded that threads should be first-class product objects and that each thread should produce one durable semantic result, while the real implementation should persist the same model in Bun-side SQLite instead of JSON.",
  });

  poc.updateThread({
    threadId: directThread.id,
    status: "completed",
  });

  /**
   * Step 3:
   * Run verification and capture a final result for the thread.
   */
  const verificationThread = poc.startThread({
    kind: "verification",
    objective: "Run verification and capture the result as a routing input.",
  });

  poc.recordVerification({
    threadId: verificationThread.id,
    kind: "test",
    status: "failed",
    summary:
      "Verification exposed one remaining place where transcript reconstruction still leaks into product behavior.",
    command: "bun test structured-session-state-poc",
  });

  poc.setThreadResult({
    threadId: verificationThread.id,
    kind: "verification-summary",
    summary:
      "Recorded the failed verification run as the thread result so routing can start from durable state instead of raw logs.",
    body: "The verification result should be treated as first-class routing state, and the remaining gap is projecting that verification state cleanly in the UI instead of falling back to transcript reconstruction.",
  });

  poc.updateThread({
    threadId: verificationThread.id,
    status: "failed",
    blockedReason:
      "Verification exposed one remaining transcript-derived assumption that should move into structured state.",
  });

  /**
   * Step 4:
   * Start a delegated workflow, project its top-level status, and enter waiting.
   */
  const workflowThread = poc.startThread({
    kind: "workflow",
    objective: "Represent a delegated Smithers workflow in the top-level session model.",
  });

  const workflow = poc.startWorkflow({
    threadId: workflowThread.id,
    smithersRunId: "smithers-run-4021",
    workflowName: "workflow-resume-poc",
    summary: "Delegated workflow started and is now visible at the session level.",
  });

  poc.updateWorkflow({
    workflowId: workflow.id,
    status: "waiting",
    summary: "Delegated workflow reached a durable pause waiting for clarification.",
  });

  poc.updateThread({
    threadId: workflowThread.id,
    status: "waiting",
    blockedReason:
      "The workflow is paused until the workflow-to-thread ownership rule is clarified.",
  });

  poc.setWaitingState({
    threadId: workflowThread.id,
    reason: "Need to clarify when a delegated workflow should get its own top-level thread.",
    resumeWhen: "Resume when the user answers the workflow/thread ownership question.",
  });

  const afterStructuredState = poc.getSessionView();
  const threads = poc.getThreadList();
  const workflowDetail = poc.getThreadDetail(workflowThread.id);

  /**
   * Step 5:
   * Reload from disk to prove the model survives persistence.
   */
  const reloaded = StructuredSessionPoc.load(filePath);
  const afterReload = reloaded.getSessionView();

  if (JSON.stringify(afterStructuredState) !== JSON.stringify(afterReload)) {
    throw new Error("Reloaded session view does not match the persisted final session view.");
  }

  return {
    persistedFile: poc.getPersistedFilePath(),
    beforeStructuredState,
    afterStructuredState,
    threads,
    workflowDetail,
    afterReload,
  };
}

/**
 * Running the file prints the lifecycle in the same order a human should read
 * and understand it.
 */
if (import.meta.main) {
  const result = runPoc();

  console.log("\nStructured Session State POC\n");
  console.log(`Persisted file: ${result.persistedFile}\n`);

  console.log("1. Before any structured records exist:");
  console.log(JSON.stringify(result.beforeStructuredState, null, 2));

  console.log("\n2. After running the full lifecycle:");
  console.log(JSON.stringify(result.afterStructuredState, null, 2));

  console.log("\n3. Thread list:");
  console.log(JSON.stringify(result.threads, null, 2));

  console.log("\n4. Workflow thread detail:");
  console.log(JSON.stringify(result.workflowDetail, null, 2));

  console.log("\n5. After reload:");
  console.log(JSON.stringify(result.afterReload, null, 2));

  console.log("\nPOC completed successfully.");
}
