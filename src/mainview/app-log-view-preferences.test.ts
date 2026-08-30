import { describe, expect, it } from "bun:test";
import { createAppLogViewPreferencesWriter } from "./app-log-view-preferences";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("app log view preference writer", () => {
  it("commits overlapping saves in submission order", async () => {
    const first = deferred();
    const writes: Array<{ scrollTop: number; followTail: boolean }> = [];
    const writer = createAppLogViewPreferencesWriter(async (preferences) => {
      writes.push(preferences);
      if (writes.length === 1) await first.promise;
    });

    const firstWrite = writer.write({ scrollTop: 10, followTail: false });
    const secondWrite = writer.write({ scrollTop: 80, followTail: true });
    await Promise.resolve();

    expect(writes).toEqual([{ scrollTop: 10, followTail: false }]);
    first.resolve();
    await Promise.all([firstWrite, secondWrite]);
    expect(writes).toEqual([
      { scrollTop: 10, followTail: false },
      { scrollTop: 80, followTail: true },
    ]);
  });

  it("continues with the latest save after an earlier save fails", async () => {
    const writes: number[] = [];
    const writer = createAppLogViewPreferencesWriter(async (preferences) => {
      writes.push(preferences.scrollTop);
      if (writes.length === 1) throw new Error("first save failed");
    });

    await expect(writer.write({ scrollTop: 10, followTail: false })).rejects.toThrow(
      "first save failed",
    );
    await writer.write({ scrollTop: 80, followTail: false });
    expect(writes).toEqual([10, 80]);
  });
});
