import type {
  WorkspaceRequestUserInputQuestion,
  WorkspaceRequestUserInputRequest,
} from "../shared/workspace-contract";

export type RequestUserInputQuestionKey = `${string}:${string}`;

export interface RequestUserInputOwnerGroup {
  surfacePiSessionId: string;
  workspaceSessionId: string;
  threadId: string | null;
  ownerTitle: string;
  requests: WorkspaceRequestUserInputRequest[];
}

export function getRequestUserInputQuestionKey(
  requestId: string,
  questionId: string,
): RequestUserInputQuestionKey {
  return `${requestId}:${questionId}`;
}

export function isRequestUserInputQuestionOpen(
  question: WorkspaceRequestUserInputQuestion,
): boolean {
  return question.status === "open";
}

export function countRequestUserInputQuestions(
  requests: readonly WorkspaceRequestUserInputRequest[],
): number {
  return requests.reduce((count, request) => count + request.questions.length, 0);
}

export function countOpenRequestUserInputQuestions(
  requests: readonly WorkspaceRequestUserInputRequest[],
): number {
  return requests.reduce(
    (count, request) => count + request.questions.filter(isRequestUserInputQuestionOpen).length,
    0,
  );
}

export function groupRequestUserInputRequests(
  requests: readonly WorkspaceRequestUserInputRequest[],
): RequestUserInputOwnerGroup[] {
  const groups = new Map<string, RequestUserInputOwnerGroup>();
  for (const request of requests) {
    const key = request.surfacePiSessionId;
    const existing = groups.get(key);
    if (existing) {
      existing.requests.push(request);
      continue;
    }
    groups.set(key, {
      surfacePiSessionId: request.surfacePiSessionId,
      workspaceSessionId: request.workspaceSessionId,
      threadId: request.threadId,
      ownerTitle: request.ownerTitle,
      requests: [request],
    });
  }

  return Array.from(groups.values());
}

export function getFirstOpenRequestUserInputQuestionKey(
  requests: readonly WorkspaceRequestUserInputRequest[],
): RequestUserInputQuestionKey | null {
  for (const request of requests) {
    const question = request.questions.find(isRequestUserInputQuestionOpen);
    if (question) {
      return getRequestUserInputQuestionKey(request.requestId, question.questionId);
    }
  }
  return null;
}
