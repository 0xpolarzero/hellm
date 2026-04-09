export const workerRequests = [];
export const runtimeTransitions = [];

function readStatus(raw) {
  if (
    raw === "completed" ||
    raw === "blocked" ||
    raw === "waiting_input" ||
    raw === "failed"
  ) {
    return raw;
  }
  return "completed";
}

function readLines(raw, fallback) {
  if (!raw) {
    return fallback;
  }

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function resetFakePiSdkState() {
  workerRequests.length = 0;
  runtimeTransitions.length = 0;
}

export async function runWorker(request) {
  workerRequests.push(request);
  const status = readStatus(process.env.HELLM_FAKE_PI_STATUS);
  const summary = process.env.HELLM_FAKE_PI_OUTPUT_SUMMARY ?? request.objective;

  return {
    status,
    outputSummary: summary,
    conclusions: readLines(process.env.HELLM_FAKE_PI_CONCLUSIONS, [summary]),
    unresolvedIssues:
      status === "blocked" || status === "failed"
        ? readLines(
            process.env.HELLM_FAKE_PI_UNRESOLVED_ISSUES,
            [`Deterministic fake pi SDK returned ${status}.`],
          )
        : [],
  };
}

export const sessionRuntime = {
  async replaceSession(transition) {
    runtimeTransitions.push(transition);
  },
};
