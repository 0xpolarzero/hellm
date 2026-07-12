import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import { type PromptTarget, type RuntimeContractError } from "@svvy/core";

import type { RuntimeSurfaceQueueWakeReason } from "./runtime-surface-queue-wake-port";

export interface RuntimeQueueWakeServiceService {
  wakeSurface(input: {
    readonly target: PromptTarget;
    readonly reason: RuntimeSurfaceQueueWakeReason;
  }): Effect.Effect<void, RuntimeContractError>;
}

export class RuntimeQueueWakeService extends Context.Service<
  RuntimeQueueWakeService,
  RuntimeQueueWakeServiceService
>()("@svvy/runtime/RuntimeQueueWakeService") {}
