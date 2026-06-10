import { describe, expect, it } from "bun:test";
import type { WorkspaceRequestUserInputRequest } from "../shared/workspace-contract";
import {
  countOpenRequestUserInputQuestions,
  countRequestUserInputQuestions,
  getFirstOpenRequestUserInputQuestionKey,
  groupRequestUserInputRequests,
} from "./request-user-input-panel";

function createRequest(
  input: Partial<WorkspaceRequestUserInputRequest> & {
    requestId: string;
    surfacePiSessionId: string;
  },
): WorkspaceRequestUserInputRequest {
  return {
    requestId: input.requestId,
    workspaceSessionId: input.workspaceSessionId ?? "session-1",
    surfacePiSessionId: input.surfacePiSessionId,
    threadId: input.threadId ?? null,
    ownerTitle: input.ownerTitle ?? "Orchestrator",
    variant: input.variant ?? "nonblocking",
    status: input.status ?? "open",
    createdAt: input.createdAt ?? "2026-04-10T10:00:00.000Z",
    completedAt: input.completedAt ?? null,
    timeout: input.timeout ?? null,
    questions: input.questions ?? [
      {
        questionId: `${input.requestId}-question`,
        ordinal: 0,
        title: "Scope",
        question: "Which scope should proceed?",
        defaultAnswer: {
          kind: "option",
          label: "Small",
          text: "Small",
        },
        choices: [
          {
            optionId: `${input.requestId}-option-small`,
            ordinal: 0,
            label: "Small",
            description: "Make the smallest useful change.",
            recommended: true,
          },
          {
            optionId: `${input.requestId}-option-broad`,
            ordinal: 1,
            label: "Broad",
            description: "Take the broader slice.",
            recommended: false,
          },
        ],
        status: "open",
      },
    ],
  };
}

describe("request user input panel helpers", () => {
  it("groups open requests by owning surface without merging separate surfaces", () => {
    const groups = groupRequestUserInputRequests([
      createRequest({ requestId: "rui-1", surfacePiSessionId: "surface-a" }),
      createRequest({ requestId: "rui-2", surfacePiSessionId: "surface-b", ownerTitle: "Thread" }),
      createRequest({ requestId: "rui-3", surfacePiSessionId: "surface-a" }),
    ]);

    expect(
      groups.map((group) => [
        group.surfacePiSessionId,
        group.requests.map((request) => request.requestId),
      ]),
    ).toEqual([
      ["surface-a", ["rui-1", "rui-3"]],
      ["surface-b", ["rui-2"]],
    ]);
  });

  it("selects the first unanswered question as the default expanded card", () => {
    const first = createRequest({
      requestId: "rui-1",
      surfacePiSessionId: "surface-a",
      questions: [
        {
          questionId: "ruiq-answered",
          ordinal: 0,
          title: "Answered",
          question: "Already answered?",
          defaultAnswer: { kind: "custom", text: "Default" },
          choices: [],
          status: "answered",
        },
        {
          questionId: "ruiq-open",
          ordinal: 1,
          title: "Open",
          question: "Still open?",
          defaultAnswer: { kind: "custom", text: "Default" },
          choices: [],
          status: "open",
        },
      ],
    });

    expect(getFirstOpenRequestUserInputQuestionKey([first])).toBe("rui-1:ruiq-open");
  });

  it("counts questions instead of request records", () => {
    expect(
      countRequestUserInputQuestions([
        createRequest({
          requestId: "rui-1",
          surfacePiSessionId: "surface-a",
          questions: [
            {
              questionId: "ruiq-1",
              ordinal: 0,
              title: "First",
              question: "First question?",
              defaultAnswer: { kind: "custom", text: "Default" },
              choices: [],
              status: "open",
            },
            {
              questionId: "ruiq-2",
              ordinal: 1,
              title: "Second",
              question: "Second question?",
              defaultAnswer: { kind: "custom", text: "Default" },
              choices: [],
              status: "open",
            },
          ],
        }),
        createRequest({ requestId: "rui-2", surfacePiSessionId: "surface-a" }),
      ]),
    ).toBe(3);
  });

  it("counts only answerable questions for owner status copy", () => {
    expect(
      countOpenRequestUserInputQuestions([
        createRequest({
          requestId: "rui-answered",
          surfacePiSessionId: "surface-a",
          questions: [
            {
              questionId: "ruiq-answered",
              ordinal: 0,
              title: "Done",
              question: "Already answered?",
              defaultAnswer: { kind: "custom", text: "Default" },
              choices: [],
              status: "answered",
            },
          ],
        }),
        createRequest({ requestId: "rui-open", surfacePiSessionId: "surface-a" }),
      ]),
    ).toBe(1);
  });
});
