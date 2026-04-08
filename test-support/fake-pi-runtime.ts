import type {
  PiRuntimeBridge,
  PiRuntimeTransition,
  PiWorkerRequest,
  PiWorkerResult,
} from "@hellm/pi-bridge";

export class FakePiRuntimeBridge implements PiRuntimeBridge {
  readonly connected = true;
  readonly runtime = "pi";
  readonly workerRequests: PiWorkerRequest[] = [];
  readonly transitions: PiRuntimeTransition[] = [];
  private readonly queue: PiWorkerResult[] = [];

  enqueueResult(result: PiWorkerResult): void {
    this.queue.push(result);
  }

  async runWorker(request: PiWorkerRequest): Promise<PiWorkerResult> {
    this.workerRequests.push(request);
    const result = this.queue.shift();
    if (!result) {
      throw new Error("No queued fake pi worker result.");
    }
    return result;
  }

  async switchRuntime(
    transition: PiRuntimeTransition,
  ): Promise<PiRuntimeTransition> {
    this.transitions.push(transition);
    return transition;
  }
}
