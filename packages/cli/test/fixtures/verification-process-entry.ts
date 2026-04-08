import { executeHeadlessRun, serializeJsonlEvents } from "@hellm/cli";
import { createOrchestrator } from "@hellm/orchestrator";
import {
  FakeVerificationRunner,
  createVerificationFixture,
} from "@hellm/test-support";

const verificationRunner = new FakeVerificationRunner();
verificationRunner.enqueueResult({
  status: "failed",
  records: [
    createVerificationFixture({
      id: "verification-process-build",
      kind: "build",
      status: "passed",
      summary: "Build passed",
    }),
    createVerificationFixture({
      id: "verification-process-test",
      kind: "test",
      status: "failed",
      summary: "Process boundary test failure",
    }),
  ],
  artifacts: [],
});

const orchestrator = createOrchestrator({
  clock: () => "2026-04-08T09:00:00.000Z",
  verificationRunner,
});

const result = await executeHeadlessRun(
  {
    threadId: "cli-verification-process",
    prompt: "Verify this branch before merging.",
    cwd: process.cwd(),
    routeHint: "verification",
    workflowSeedInput: {
      verificationKinds: ["build", "test"],
    },
  },
  { orchestrator },
);

console.log(serializeJsonlEvents(result.events));
