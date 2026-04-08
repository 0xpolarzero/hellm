import type {
  VerificationRequest,
  VerificationRunResult,
  VerificationRunner,
} from "@hellm/verification";

export class FakeVerificationRunner implements VerificationRunner {
  readonly calls: VerificationRequest[] = [];
  private readonly queue: VerificationRunResult[] = [];

  enqueueResult(result: VerificationRunResult): void {
    this.queue.push(result);
  }

  async run(request: VerificationRequest): Promise<VerificationRunResult> {
    this.calls.push(request);
    const result = this.queue.shift();
    if (!result) {
      throw new Error("No queued fake verification result.");
    }
    return result;
  }
}
