import { readFile } from "node:fs/promises";
import { describe, expect, it } from "bun:test";

describe("QueuedMessagesStrip source", () => {
  it("keeps failed queued rows recoverable without making them draggable or steerable", async () => {
    const source = await readFile(new URL("./QueuedMessagesStrip.svelte", import.meta.url), "utf8");

    expect(source).toContain('prompt.status === "failed"');
    expect(source).toContain('aria-label="Restore failed queued message"');
    expect(source).toContain("onclick={() => onEdit(prompt.id)}");
    expect(source).toContain('aria-label="Delete failed queued message"');
    expect(source).toContain('aria-label="Dismiss failed queue item"');
    expect(source).toContain('data-reorderable={isLocked(prompt) ? "false" : "true"}');
    expect(source).not.toContain('aria-label="Steer failed queued message"');
  });
});
