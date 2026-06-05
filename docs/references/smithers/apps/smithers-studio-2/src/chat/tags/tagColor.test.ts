import { describe, expect, test } from "bun:test";
import { tagColor } from "./tagColor";
import type { Tag } from "./Tag";

const tag = (id: string, kind: Tag["kind"] = "topic"): Tag => ({ id, label: id, kind });

describe("tagColor", () => {
  test("is deterministic for the same tag", () => {
    expect(tagColor(tag("auth"))).toBe(tagColor(tag("auth")));
  });

  test("different ids generally yield different hues", () => {
    expect(tagColor(tag("auth"))).not.toBe(tagColor(tag("billing")));
  });

  test("returns an hsl color in range", () => {
    const match = /^hsl\((\d+) (\d+)% (\d+)%\)$/.exec(tagColor(tag("anything")));
    expect(match).not.toBeNull();
    const hue = Number(match![1]);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });

  test("kind shifts the tone for the same id", () => {
    expect(tagColor(tag("x", "topic"))).not.toBe(tagColor(tag("x", "workflow")));
  });
});
