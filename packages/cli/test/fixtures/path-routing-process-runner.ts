import { executeHeadlessRun, serializeJsonlEvents, type HeadlessRequest } from "@hellm/cli";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import { FakeVerificationRunner, fixedClock } from "@hellm/test-support";

const rawRequest = process.env.HELLM_REQUEST_JSON;
if (!rawRequest) {
  throw new Error("HELLM_REQUEST_JSON must be provided.");
}

const request = JSON.parse(rawRequest) as HeadlessRequest;
const shouldFakeVerification = process.env.HELLM_FAKE_VERIFICATION === "1";
const verificationRunner = shouldFakeVerification
  ? new FakeVerificationRunner()
  : undefined;

if (verificationRunner) {
  verificationRunner.enqueueResult({
    status: "passed",
    records: [
      {
        id: "verification-process",
        kind: "build",
        status: "passed",
        summary: "Build passed in subprocess fixture.",
        createdAt: "2026-04-08T09:00:00.000Z",
      },
    ],
    artifacts: [],
  });
}

const orchestrator = createOrchestrator({
  clock: fixedClock(),
  ...(verificationRunner ? { verificationRunner } : {}),
  contextLoader: {
    async load(runRequest) {
      return {
        sessionHistory: [],
        repoAndWorktree: { cwd: runRequest.cwd },
        agentsInstructions: [],
        relevantSkills: [],
        priorEpisodes: [],
        priorArtifacts: [],
        state: createEmptySessionState({
          sessionId: runRequest.threadId,
          sessionCwd: runRequest.cwd,
        }),
      };
    },
  },
});

const result = await executeHeadlessRun(request, { orchestrator });
console.log(serializeJsonlEvents(result.events));
