import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { PromptTarget, RuntimeContractError } from "@svvy/core";

export type RuntimeSurfaceQueueWakeReason =
  | "message-submitted"
  | "request-input-answer-queued"
  | "queue-steered"
  | "runtime-queue-inserted";

export interface RuntimeLayerSurfaceQueueWakePortService {
  wakeSurfaceQueue(input: {
    readonly target: PromptTarget;
    readonly reason: RuntimeSurfaceQueueWakeReason;
  }): Effect.Effect<void, RuntimeContractError>;
}

export interface RuntimeLayerSurfaceQueueWakePort {
  readonly _tag: "RuntimeLayerSurfaceQueueWakePort";
}

export const RuntimeLayerSurfaceQueueWakePort = Context.Service<
  RuntimeLayerSurfaceQueueWakePort,
  RuntimeLayerSurfaceQueueWakePortService
>("@svvy/runtime/RuntimeLayerSurfaceQueueWakePort");
