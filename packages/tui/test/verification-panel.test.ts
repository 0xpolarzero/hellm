import { describe, expect, it } from "bun:test";
import {
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
  createVerificationRecord,
  type ThreadSnapshot,
} from "@hellm/session-model";
import { projectThreadSnapshot, renderProjection } from "@hellm/tui";

function createSnapshot(input: {
  verification: ThreadSnapshot["verification"];
}): ThreadSnapshot {
  const timestamp = "2026-04-08T09:00:00.000Z";
  return {
    thread: createThread({
      id: "thread-verification-panel",
      kind: "verification",
      objective: "Show verification state in the panel.",
      status: "running",
      createdAt: timestamp,
    }),
    episodes: [],
    artifacts: [],
    verification: input.verification,
    alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
    workflowRuns: [],
  };
}

describe("@hellm/tui verification panel", () => {
  it("shows an unknown fallback line when no verification records exist", () => {
    const projection = projectThreadSnapshot(
      createSnapshot({
        verification: createGlobalVerificationState(),
      }),
    );

    expect(projection.verificationPanel).toEqual([
      "overall unknown",
      "verification: unknown",
    ]);
  });

  it("renders one line per verification kind and uses the latest normalized kind record", () => {
    const projection = projectThreadSnapshot(
      createSnapshot({
        verification: createGlobalVerificationState([
          createVerificationRecord({
            id: "build-old",
            kind: "build",
            status: "passed",
            summary: "Build passed before new changes",
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
          createVerificationRecord({
            id: "manual",
            kind: "manual",
            status: "skipped",
            summary: "Manual checks deferred",
            createdAt: "2026-04-08T09:01:00.000Z",
          }),
          createVerificationRecord({
            id: "build-new",
            kind: "build",
            status: "failed",
            summary: "Build failed after latest change",
            createdAt: "2026-04-08T09:02:00.000Z",
          }),
        ]),
      }),
    );

    expect(projection.verificationPanel[0]).toBe("overall failed");
    expect(projection.verificationPanel).toContain(
      "build: failed - Build failed after latest change",
    );
    expect(projection.verificationPanel).toContain(
      "manual: skipped - Manual checks deferred",
    );
    expect(
      projection.verificationPanel.filter((line) => line.startsWith("build:")),
    ).toHaveLength(1);
    expect(projection.verificationPanel).not.toContain(
      "build: passed - Build passed before new changes",
    );
  });

  it("keeps verification lines grouped under the verification section in rendered output", () => {
    const projection = projectThreadSnapshot(
      createSnapshot({
        verification: createGlobalVerificationState([
          createVerificationRecord({
            id: "test-status",
            kind: "test",
            status: "passed",
            summary: "Unit tests passed",
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
        ]),
      }),
    );
    const rendered = renderProjection(projection);
    const verificationHeaderIndex = rendered.indexOf("[verification]");
    const workflowHeaderIndex = rendered.indexOf("[workflow]");

    expect(verificationHeaderIndex).toBeGreaterThan(-1);
    expect(workflowHeaderIndex).toBeGreaterThan(verificationHeaderIndex);
    expect(
      rendered.slice(verificationHeaderIndex + 1, workflowHeaderIndex),
    ).toEqual(projection.verificationPanel);
  });
});
