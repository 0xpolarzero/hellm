import type {
  SmithersApprovalDecision,
  SmithersResumeRequest,
  SmithersRunRequest,
  SmithersRunResult,
  SmithersWorkflowBridge,
} from "@hellm/smithers-bridge";

export class FakeSmithersWorkflowBridge implements SmithersWorkflowBridge {
  readonly enabled = true;
  readonly engine = "smithers";
  readonly runRequests: SmithersRunRequest[] = [];
  readonly resumeRequests: SmithersResumeRequest[] = [];
  readonly approvals: Array<{ runId: string; decision: SmithersApprovalDecision }> =
    [];
  readonly denials: Array<{ runId: string; decision: SmithersApprovalDecision }> =
    [];
  private readonly runQueue: SmithersRunResult[] = [];
  private readonly resumeQueue: SmithersRunResult[] = [];

  enqueueRunResult(result: SmithersRunResult): void {
    this.runQueue.push(result);
  }

  enqueueResumeResult(result: SmithersRunResult): void {
    this.resumeQueue.push(result);
  }

  async runWorkflow(request: SmithersRunRequest): Promise<SmithersRunResult> {
    this.runRequests.push(request);
    const result = this.runQueue.shift();
    if (!result) {
      throw new Error("No queued fake Smithers run result.");
    }
    return result;
  }

  async resumeWorkflow(
    request: SmithersResumeRequest,
  ): Promise<SmithersRunResult> {
    this.resumeRequests.push(request);
    const result = this.resumeQueue.shift();
    if (!result) {
      throw new Error("No queued fake Smithers resume result.");
    }
    return result;
  }

  async approveRun(
    runId: string,
    decision: SmithersApprovalDecision,
  ): Promise<void> {
    this.approvals.push({ runId, decision });
  }

  async denyRun(
    runId: string,
    decision: SmithersApprovalDecision,
  ): Promise<void> {
    this.denials.push({ runId, decision });
  }
}
