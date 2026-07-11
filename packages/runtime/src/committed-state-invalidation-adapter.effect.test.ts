import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type { StateInvalidationDescriptor, WorkspaceId } from "@svvy/core";
import {
  CommittedStateInvalidationPublicationError,
  publishCommittedStateInvalidations,
} from "./committed-state-invalidation-adapter";
import { layerRuntimeCommittedStateInvalidationPublication } from "./runtime-committed-state-invalidation-publication";
import { RuntimeEventBus } from "./runtime-event-bus";

describe("committed state invalidation adapter", () => {
  it.effect("passes only the supplied committed descriptors to the runtime event bus", () =>
    Effect.promise(async () => {
      const published: StateInvalidationDescriptor[][] = [];
      const runtime = ManagedRuntime.make(
        layerRuntimeCommittedStateInvalidationPublication.pipe(
          Layer.provide(
            Layer.succeed(
              RuntimeEventBus,
              RuntimeEventBus.of({
                publishLive: () => Effect.die("unexpected live publication"),
                publishStateInvalidations: ({ afterCommit }) =>
                  Effect.sync(() => {
                    published.push([...afterCommit]);
                    return [];
                  }),
                subscribe: () => Effect.die("unexpected subscription"),
              }),
            ),
          ),
        ),
      );
      const descriptor = {
        scope: "workspace",
        workspaceId: "workspace-publication" as WorkspaceId,
        invalidation: { model: "sessionNavigation" },
      } satisfies StateInvalidationDescriptor;

      try {
        await runtime.context();
        assert.deepStrictEqual(await publishCommittedStateInvalidations(runtime, [descriptor]), {
          acceptedDescriptorCount: 1,
          rebaselineRequired: false,
        });
        assert.deepStrictEqual(published, [[descriptor]]);
      } finally {
        await runtime.dispose();
      }
    }),
  );

  it.effect("reports a typed committed-write rebaseline error after runtime disposal", () =>
    Effect.promise(async () => {
      const runtime = ManagedRuntime.make(
        layerRuntimeCommittedStateInvalidationPublication.pipe(
          Layer.provide(
            Layer.succeed(
              RuntimeEventBus,
              RuntimeEventBus.of({
                publishLive: () => Effect.die("unexpected live publication"),
                publishStateInvalidations: () => Effect.succeed([]),
                subscribe: () => Effect.die("unexpected subscription"),
              }),
            ),
          ),
        ),
      );
      const descriptor = {
        scope: "workspace",
        workspaceId: "workspace-disposed" as WorkspaceId,
        invalidation: { model: "sessionNavigation" },
      } satisfies StateInvalidationDescriptor;
      await runtime.context();
      await runtime.dispose();

      const error = await publishCommittedStateInvalidations(runtime, [descriptor]).catch(
        (cause) => cause,
      );
      assert.instanceOf(error, CommittedStateInvalidationPublicationError);
      assert.deepStrictEqual(
        {
          type: error.type,
          reason: error.reason,
          committed: error.committed,
          rebaselineRequired: error.rebaselineRequired,
          afterCommit: error.afterCommit,
        },
        {
          type: "committed-state-invalidation-publication-error",
          reason: "publication-failed",
          committed: true,
          rebaselineRequired: true,
          afterCommit: [descriptor],
        },
      );
    }),
  );
});
