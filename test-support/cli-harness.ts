import {
  executeHeadlessRun,
  serializeJsonlEvents,
  type HeadlessRequest,
  type HeadlessResult,
} from "@hellm/cli";
import type { Orchestrator } from "@hellm/orchestrator";

export async function runHeadlessHarness(
  request: HeadlessRequest,
  orchestrator?: Orchestrator,
): Promise<{ result: HeadlessResult; jsonl: string[] }> {
  const result = await executeHeadlessRun(
    request,
    orchestrator ? { orchestrator } : {},
  );
  return {
    result,
    jsonl: serializeJsonlEvents(result.events).split("\n"),
  };
}
