import { RuntimeContractError } from "@svvy/core";

export type AppLifecycleState =
  | "starting"
  | "ready"
  | "startup-failed"
  | "shutting-down"
  | "closed";

export interface AppLifecycleShutdownReceipt {
  readonly state: "closed";
  readonly reason: string;
}

export class AppLifecycleCoordinator {
  private state: AppLifecycleState = "starting";
  private startupError: unknown;
  private shutdownPromise: Promise<AppLifecycleShutdownReceipt> | null = null;

  markReady(): void {
    if (this.state !== "starting") return;
    this.state = "ready";
  }

  markStartupFailed(error: unknown): void {
    this.startupError = error;
    this.state = "startup-failed";
  }

  assertAccepting(operation: string): void {
    if (this.state === "ready") return;
    if (this.state === "starting") {
      throw new RuntimeContractError({
        operation,
        reason: "startup-pending",
        message: "App runtime startup has not completed.",
      });
    }
    if (this.state === "startup-failed") {
      throw new RuntimeContractError({
        operation,
        reason: "startup-failed",
        message: "App runtime startup failed.",
        cause: this.startupError,
      });
    }
    throw new RuntimeContractError({
      operation,
      reason: "runtime-shutdown",
      message: "App runtime is shutting down.",
    });
  }

  shutdown(
    reason: string,
    closeScopes: () => Promise<void>,
    prepare: () => Promise<void>,
    dispose: () => Promise<void>,
  ): Promise<AppLifecycleShutdownReceipt> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.state = "shutting-down";
    this.shutdownPromise = (async () => {
      try {
        await closeScopes();
        await prepare();
      } finally {
        try {
          await dispose();
        } finally {
          this.state = "closed";
        }
      }
      return { state: "closed", reason };
    })();
    return this.shutdownPromise;
  }

  getState(): AppLifecycleState {
    return this.state;
  }
}
