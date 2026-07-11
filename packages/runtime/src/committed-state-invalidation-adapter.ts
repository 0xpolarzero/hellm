import * as Effect from "effect/Effect";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import type { StateInvalidationDescriptor } from "@svvy/core";
import { RuntimeCommittedStateInvalidationPublication } from "./runtime-committed-state-invalidation-publication";

export interface CommittedStateInvalidationPublicationReceipt {
  readonly acceptedDescriptorCount: number;
  readonly rebaselineRequired: false;
}

export class CommittedStateInvalidationPublicationError extends Error {
  readonly type = "committed-state-invalidation-publication-error" as const;
  readonly reason = "publication-failed" as const;
  readonly committed = true as const;
  readonly rebaselineRequired = true as const;

  constructor(
    readonly afterCommit: readonly StateInvalidationDescriptor[],
    readonly error: unknown,
  ) {
    super(
      "State mutation was committed, but its read-model invalidations were not published; consumers must rebaseline.",
    );
    this.name = "CommittedStateInvalidationPublicationError";
  }
}

/** App-bootstrap-only bridge from committed state results into the runtime event bus. */
export async function publishCommittedStateInvalidations<RuntimeContext, RuntimeError>(
  managedRuntime: ManagedRuntime.ManagedRuntime<RuntimeContext, RuntimeError>,
  afterCommit: readonly StateInvalidationDescriptor[],
): Promise<CommittedStateInvalidationPublicationReceipt> {
  if (afterCommit.length === 0) {
    return { acceptedDescriptorCount: 0, rebaselineRequired: false };
  }
  try {
    await managedRuntime.runPromise(
      Effect.gen(function* () {
        const publication = yield* RuntimeCommittedStateInvalidationPublication;
        yield* publication.publish({ afterCommit });
      }) as Effect.Effect<void, unknown, never>,
    );
    return {
      acceptedDescriptorCount: afterCommit.length,
      rebaselineRequired: false,
    };
  } catch (error) {
    throw new CommittedStateInvalidationPublicationError([...afterCommit], error);
  }
}
