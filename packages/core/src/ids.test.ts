import { describe, expect, it } from "bun:test";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { JsonObject, UtcDateTime } from "./ids";

describe("@svvy/core shared primitives", () => {
  it("decodes persisted UTC timestamps from ISO strings", () => {
    const decoded = Schema.decodeUnknownSync(UtcDateTime)("2026-06-21T12:34:56.789Z");

    expect(DateTime.formatIso(decoded)).toBe("2026-06-21T12:34:56.789Z");
  });

  it("decodes JSON-safe object values", () => {
    const decoded = Schema.decodeUnknownSync(JsonObject)({
      text: "ok",
      count: 1,
      enabled: true,
      none: null,
      nested: { value: ["a", 2, false] },
    });

    expect(decoded).toEqual({
      text: "ok",
      count: 1,
      enabled: true,
      none: null,
      nested: { value: ["a", 2, false] },
    });
  });
});
