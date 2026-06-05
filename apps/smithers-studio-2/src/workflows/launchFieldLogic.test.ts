import { describe, expect, test } from "bun:test";
import {
  buildLaunchInput,
  initialLaunchValues,
  launchFieldKind,
  launchFieldRawValue,
  launchValidationErrors,
  parseFreeformInput,
} from "./launchFieldLogic";
import type { WorkflowLaunchField } from "./workflowsApi";

/**
 * Real unit tests for the launch-field logic — pure functions, real inputs, no
 * mocking. Exercises the kind normalization, validation, and (critically) the
 * input builder's contract that a cleared optional number is OMITTED, never 0.
 */

function field(overrides: Partial<WorkflowLaunchField> & { key: string }): WorkflowLaunchField {
  return {
    name: overrides.name ?? overrides.key,
    type: overrides.type ?? "string",
    defaultValue: overrides.defaultValue ?? null,
    required: overrides.required ?? false,
    ...overrides,
  };
}

describe("launchFieldKind", () => {
  test("maps numeric type aliases to number", () => {
    for (const type of ["number", "integer", "int", "float", "double"]) {
      expect(launchFieldKind(field({ key: "n", type }))).toBe("number");
    }
  });

  test("maps boolean aliases, object, array/list, json/any/unknown", () => {
    expect(launchFieldKind(field({ key: "b", type: "bool" }))).toBe("boolean");
    expect(launchFieldKind(field({ key: "b", type: "boolean" }))).toBe("boolean");
    expect(launchFieldKind(field({ key: "o", type: "object" }))).toBe("object");
    expect(launchFieldKind(field({ key: "a", type: "list" }))).toBe("array");
    expect(launchFieldKind(field({ key: "a", type: "array" }))).toBe("array");
    expect(launchFieldKind(field({ key: "j", type: "any" }))).toBe("json");
    expect(launchFieldKind(field({ key: "j", type: "unknown" }))).toBe("json");
  });

  test("is case/whitespace-insensitive and defaults unknown strings to string", () => {
    expect(launchFieldKind(field({ key: "n", type: "  NUMBER " }))).toBe("number");
    expect(launchFieldKind(field({ key: "s", type: null }))).toBe("string");
    expect(launchFieldKind(field({ key: "s", type: "text" }))).toBe("string");
  });
});

describe("launchFieldRawValue + initialLaunchValues", () => {
  test("prefers an explicit value, falls back to the field default", () => {
    const f = field({ key: "target", defaultValue: "main" });
    expect(launchFieldRawValue(f, { target: "release" })).toBe("release");
    expect(launchFieldRawValue(f, {})).toBe("main");
    expect(launchFieldRawValue(field({ key: "x" }), {})).toBe("");
  });

  test("an explicit empty-string value is honored over the default", () => {
    const f = field({ key: "target", defaultValue: "main" });
    expect(launchFieldRawValue(f, { target: "" })).toBe("");
  });

  test("initialLaunchValues seeds each key from its default", () => {
    expect(
      initialLaunchValues([field({ key: "target", defaultValue: "main" }), field({ key: "note" })]),
    ).toEqual({ target: "main", note: "" });
  });
});

describe("launchValidationErrors", () => {
  test("required non-boolean field with empty value errors", () => {
    const errors = launchValidationErrors([field({ key: "target", name: "Target", required: true })], {
      target: "  ",
    });
    expect(errors.target).toBe("Target is required.");
  });

  test("required boolean is never flagged as missing", () => {
    const errors = launchValidationErrors(
      [field({ key: "dryRun", name: "Dry run", type: "boolean", required: true })],
      { dryRun: "" },
    );
    expect(errors.dryRun).toBeUndefined();
  });

  test("non-numeric value for a number field errors; valid number passes", () => {
    const errors = launchValidationErrors([field({ key: "count", name: "Count", type: "number" })], {
      count: "abc",
    });
    expect(errors.count).toBe("Count must be a number.");
    expect(
      launchValidationErrors([field({ key: "count", name: "Count", type: "number" })], { count: "42" }),
    ).toEqual({});
  });

  test("object field rejecting a JSON array reports a typed message", () => {
    const errors = launchValidationErrors([field({ key: "cfg", name: "Config", type: "object" })], {
      cfg: "[1,2]",
    });
    expect(errors.cfg).toBe("Config must be a JSON object.");
  });

  test("array field rejecting a JSON object reports a typed message", () => {
    const errors = launchValidationErrors([field({ key: "tags", name: "Tags", type: "array" })], {
      tags: "{}",
    });
    expect(errors.tags).toBe("Tags must be a JSON array.");
  });

  test("malformed JSON surfaces the parser error", () => {
    const errors = launchValidationErrors([field({ key: "j", name: "J", type: "json" })], {
      j: "{not json",
    });
    expect(errors.j).toBeDefined();
  });

  test("empty optional field is skipped (no error)", () => {
    expect(launchValidationErrors([field({ key: "x", type: "number" })], { x: "" })).toEqual({});
  });
});

describe("buildLaunchInput", () => {
  test("an optional number the user cleared is OMITTED, never submitted as 0", () => {
    const input = buildLaunchInput([field({ key: "count", type: "number", required: false })], {
      count: "",
    });
    expect("count" in input).toBe(false);
  });

  test("an optional number with a value coerces to a real number", () => {
    const input = buildLaunchInput([field({ key: "count", type: "number" })], { count: " 7 " });
    expect(input.count).toBe(7);
    expect(typeof input.count).toBe("number");
  });

  test("a required number stays in the payload even when empty (validation guards it elsewhere)", () => {
    const input = buildLaunchInput([field({ key: "count", type: "number", required: true })], {
      count: "",
    });
    expect("count" in input).toBe(true);
    expect(input.count).toBe(0);
  });

  test("string field submits the raw (untrimmed) value", () => {
    const input = buildLaunchInput([field({ key: "msg" })], { msg: "  hi  " });
    expect(input.msg).toBe("  hi  ");
  });

  test("boolean coercion accepts true/1/yes/on, everything else false", () => {
    const f = field({ key: "dryRun", type: "boolean", required: true });
    expect(buildLaunchInput([f], { dryRun: "true" }).dryRun).toBe(true);
    expect(buildLaunchInput([f], { dryRun: "YES" }).dryRun).toBe(true);
    expect(buildLaunchInput([f], { dryRun: "1" }).dryRun).toBe(true);
    expect(buildLaunchInput([f], { dryRun: "on" }).dryRun).toBe(true);
    expect(buildLaunchInput([f], { dryRun: "false" }).dryRun).toBe(false);
    expect(buildLaunchInput([f], { dryRun: "nope" }).dryRun).toBe(false);
  });

  test("optional boolean with null default and no current value is omitted", () => {
    const input = buildLaunchInput([field({ key: "dryRun", type: "boolean", defaultValue: null })], {});
    expect("dryRun" in input).toBe(false);
  });

  test("optional empty field with null default is omitted entirely", () => {
    const input = buildLaunchInput([field({ key: "note", defaultValue: null })], { note: "" });
    expect("note" in input).toBe(false);
  });

  test("an empty optional object/array/json field is OMITTED, never JSON.parse(\"\")", () => {
    // Regression: a field whose default is "" (empty string, NOT null) that the
    // user leaves blank used to fall through to JSON.parse("") and throw. It must
    // be omitted instead.
    for (const type of ["object", "array", "json"]) {
      const withEmptyDefault = buildLaunchInput(
        [field({ key: "cfg", type, required: false, defaultValue: "" })],
        { cfg: "" },
      );
      expect("cfg" in withEmptyDefault).toBe(false);

      const withNullDefault = buildLaunchInput(
        [field({ key: "cfg", type, required: false, defaultValue: null })],
        { cfg: "" },
      );
      expect("cfg" in withNullDefault).toBe(false);

      // Whitespace-only is also treated as empty (trimmed).
      const whitespace = buildLaunchInput(
        [field({ key: "cfg", type, required: false, defaultValue: "" })],
        { cfg: "   " },
      );
      expect("cfg" in whitespace).toBe(false);
    }
  });

  test("a required empty object/array/json field still attempts to parse (validation guards it elsewhere)", () => {
    expect(() =>
      buildLaunchInput([field({ key: "cfg", type: "object", required: true, defaultValue: "" })], {
        cfg: "",
      }),
    ).toThrow();
  });

  test("object/array/json fields parse to real JSON values", () => {
    const fields = [
      field({ key: "cfg", type: "object" }),
      field({ key: "tags", type: "array" }),
      field({ key: "j", type: "json" }),
    ];
    const input = buildLaunchInput(fields, { cfg: '{"a":1}', tags: "[1,2]", j: '"raw"' });
    expect(input.cfg).toEqual({ a: 1 });
    expect(input.tags).toEqual([1, 2]);
    expect(input.j).toBe("raw");
  });
});

describe("parseFreeformInput", () => {
  test("empty input yields an empty object", () => {
    expect(parseFreeformInput("   ")).toEqual({});
  });

  test("valid JSON object passes through", () => {
    expect(parseFreeformInput('{"target":"main"}')).toEqual({ target: "main" });
  });

  test("non-object JSON is rejected", () => {
    expect(() => parseFreeformInput("[1,2]")).toThrow("Workflow input must be a JSON object.");
    expect(() => parseFreeformInput("42")).toThrow("Workflow input must be a JSON object.");
  });
});
