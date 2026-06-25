import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { createOrderedRuntimeStateWriteLane } from "./ordered-runtime-state-write-lane";

describe("ordered runtime state write lane", () => {
  it("runs enqueued effects in FIFO order", async () => {
    const events: string[] = [];
    const lane = createOrderedRuntimeStateWriteLane({
      runState: async (effect) => Effect.runSync(effect),
    });

    void lane.enqueue(
      "first",
      Effect.sync(() => {
        events.push("first");
      }),
    );
    void lane.enqueue(
      "second",
      Effect.sync(() => {
        events.push("second");
      }),
    );

    await lane.drain();

    expect(events).toEqual(["first", "second"]);
  });

  it("reports failed effects and continues with later writes", async () => {
    const events: string[] = [];
    const failures: string[] = [];
    const lane = createOrderedRuntimeStateWriteLane({
      runState: async (effect) => Effect.runSync(effect),
      onError: ({ label }) => failures.push(label),
    });

    await expect(
      lane.enqueue(
        "failed",
        Effect.sync(() => {
          events.push("failed");
          throw new Error("boom");
        }),
      ),
    ).rejects.toThrow("boom");
    void lane.enqueue(
      "after",
      Effect.sync(() => {
        events.push("after");
      }),
    );

    await lane.drain();

    expect(events).toEqual(["failed", "after"]);
    expect(failures).toEqual(["failed"]);
  });

  it("closes after pending writes drain and rejects later writes", async () => {
    const events: string[] = [];
    const lane = createOrderedRuntimeStateWriteLane({
      runState: async (effect) => Effect.runSync(effect),
    });

    void lane.enqueue(
      "pending",
      Effect.sync(() => {
        events.push("pending");
      }),
    );

    await lane.close("done");

    expect(events).toEqual(["pending"]);
    await expect(lane.enqueue("after-close", Effect.void)).rejects.toThrow(
      "Runtime state write lane is closed: after-close",
    );
  });
});
