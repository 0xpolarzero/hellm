import { describe, expect, it } from "bun:test";
import {
  canTransitionThreadStatus,
  createThread,
  transitionThreadStatus,
  type ThreadStatus,
} from "@hellm/session-model";

const ALL_THREAD_STATUSES: readonly ThreadStatus[] = [
  "pending",
  "running",
  "waiting_input",
  "waiting_approval",
  "blocked",
  "completed",
  "failed",
  "cancelled",
];

const EXPECTED_ALLOWED_TRANSITIONS = {
  pending: ["running", "cancelled"],
  running: [
    "waiting_input",
    "waiting_approval",
    "blocked",
    "completed",
    "failed",
    "cancelled",
  ],
  waiting_input: ["running", "cancelled"],
  waiting_approval: ["running", "failed", "cancelled"],
  blocked: ["running", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
} as const satisfies Record<ThreadStatus, readonly ThreadStatus[]>;

describe("@hellm/session-model thread status lifecycle", () => {
  it("accepts identity transitions and only the documented lifecycle edges", () => {
    for (const from of ALL_THREAD_STATUSES) {
      for (const to of ALL_THREAD_STATUSES) {
        const expected =
          from === to || EXPECTED_ALLOWED_TRANSITIONS[from].includes(to);
        expect(canTransitionThreadStatus(from, to)).toBe(expected);
      }
    }
  });

  it("transitions every allowed non-identity edge and stamps updatedAt", () => {
    const baseThread = createThread({
      id: "thread-lifecycle",
      kind: "direct",
      objective: "exercise lifecycle",
      status: "running",
      createdAt: "2026-04-08T09:00:00.000Z",
      updatedAt: "2026-04-08T09:00:00.000Z",
    });

    for (const [from, allowed] of Object.entries(EXPECTED_ALLOWED_TRANSITIONS) as [
      ThreadStatus,
      readonly ThreadStatus[],
    ][]) {
      for (const to of allowed) {
        const threadAtSource = {
          ...baseThread,
          status: from,
        };
        const transitioned = transitionThreadStatus(
          threadAtSource,
          to,
          "2026-04-08T09:01:00.000Z",
        );

        expect(transitioned).not.toBe(threadAtSource);
        expect(transitioned.status).toBe(to);
        expect(transitioned.updatedAt).toBe("2026-04-08T09:01:00.000Z");
        expect(transitioned.createdAt).toBe(baseThread.createdAt);
        expect(threadAtSource.status).toBe(from);
        expect(threadAtSource.updatedAt).toBe(baseThread.updatedAt);
      }
    }
  });

  it("allows identity transitions for every status while preserving thread metadata", () => {
    const baseThread = createThread({
      id: "thread-identity",
      kind: "smithers-workflow",
      objective: "identity lifecycle transitions",
      status: "pending",
      parentThreadId: "thread-parent",
      inputEpisodeIds: ["episode-a", "episode-b"],
      worktreePath: "/repo/worktrees/feature-status",
      smithersRunId: "run-identity",
      createdAt: "2026-04-08T09:00:00.000Z",
      updatedAt: "2026-04-08T09:00:00.000Z",
    });

    for (const status of ALL_THREAD_STATUSES) {
      const source = {
        ...baseThread,
        status,
      };

      const transitioned = transitionThreadStatus(
        source,
        status,
        "2026-04-08T09:03:00.000Z",
      );

      expect(transitioned).not.toBe(source);
      expect(transitioned.status).toBe(status);
      expect(transitioned.updatedAt).toBe("2026-04-08T09:03:00.000Z");
      expect(transitioned.id).toBe(baseThread.id);
      expect(transitioned.kind).toBe(baseThread.kind);
      expect(transitioned.objective).toBe(baseThread.objective);
      expect(transitioned.parentThreadId).toBe(baseThread.parentThreadId);
      expect(transitioned.inputEpisodeIds).toEqual(baseThread.inputEpisodeIds);
      expect(transitioned.worktreePath).toBe(baseThread.worktreePath);
      expect(transitioned.smithersRunId).toBe(baseThread.smithersRunId);
      expect(transitioned.createdAt).toBe(baseThread.createdAt);
      expect(source.updatedAt).toBe(baseThread.updatedAt);
    }
  });

  it("rejects disallowed edges, including transitions out of terminal states", () => {
    const baseThread = createThread({
      id: "thread-invalid",
      kind: "direct",
      objective: "reject invalid status changes",
      status: "running",
      createdAt: "2026-04-08T09:00:00.000Z",
    });

    for (const from of ALL_THREAD_STATUSES) {
      for (const to of ALL_THREAD_STATUSES) {
        const isAllowed =
          from === to || EXPECTED_ALLOWED_TRANSITIONS[from].includes(to);
        if (isAllowed) {
          continue;
        }

        expect(() =>
          transitionThreadStatus(
            { ...baseThread, status: from },
            to,
            "2026-04-08T09:02:00.000Z",
          ),
        ).toThrow(
          `Cannot transition thread ${baseThread.id} from ${from} to ${to}.`,
        );
      }
    }
  });

  it("defaults new threads to pending with updatedAt matching createdAt", () => {
    const thread = createThread({
      id: "thread-defaults",
      kind: "approval",
      objective: "check default lifecycle metadata",
      createdAt: "2026-04-08T09:00:00.000Z",
    });

    expect(thread.status).toBe("pending");
    expect(thread.createdAt).toBe("2026-04-08T09:00:00.000Z");
    expect(thread.updatedAt).toBe(thread.createdAt);
  });
});
