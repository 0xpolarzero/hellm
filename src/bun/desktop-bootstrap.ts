import type { DesktopBridgeErrorContract } from "@svvy/core";
import { normalizeStartupFailure } from "./startup-failure-surface";

export interface RunDesktopBootstrapInput<Facades, Result> {
  readonly awaitReadiness: () => Promise<void>;
  readonly acquireFacades: () => Promise<Facades>;
  readonly startDesktop: (facades: Facades) => Promise<Result>;
  readonly rejectRendererCalls: (error: DesktopBridgeErrorContract) => void;
  readonly cleanup: (reason: "startup-failure") => Promise<void>;
  readonly showStartupFailure: (cause: unknown) => Promise<void>;
  readonly finalizeFailure?: () => void;
  readonly onAuxiliaryFailure?: (
    error: unknown,
    phase: "renderer-rejection" | "cleanup" | "failure-surface" | "finalization",
  ) => void;
}

export async function runDesktopBootstrap<Facades, Result>(
  input: RunDesktopBootstrapInput<Facades, Result>,
): Promise<Result> {
  const reportAuxiliaryFailure = (
    error: unknown,
    phase: "renderer-rejection" | "cleanup" | "failure-surface" | "finalization",
  ): void => {
    try {
      input.onAuxiliaryFailure?.(error, phase);
    } catch {
      // Startup cleanup and the normalized startup failure remain authoritative over diagnostics.
    }
  };

  try {
    await input.awaitReadiness();
    const facades = await input.acquireFacades();
    return await input.startDesktop(facades);
  } catch (cause) {
    const startupError = normalizeStartupFailure(cause);
    try {
      input.rejectRendererCalls(startupError);
    } catch (rejectionError) {
      reportAuxiliaryFailure(rejectionError, "renderer-rejection");
    }
    try {
      await input.cleanup("startup-failure");
    } catch (cleanupError) {
      reportAuxiliaryFailure(cleanupError, "cleanup");
    }
    try {
      await input.showStartupFailure(cause);
    } catch (surfaceError) {
      reportAuxiliaryFailure(surfaceError, "failure-surface");
    }
    try {
      input.finalizeFailure?.();
    } catch (finalizationError) {
      reportAuxiliaryFailure(finalizationError, "finalization");
    }
    throw startupError;
  }
}
