import { describe, expect, test } from "bun:test";
import {
  defaultValues,
  discoverImports,
  discoverInputs,
  hasInputValueChanges,
  renderPreview,
  SEEDED_PROMPTS,
  summarize,
} from "./promptsSource";

/**
 * Pure domain tests for the prompts EDITOR surface: input discovery (frontmatter
 * → body interpolations → MDX props), import discovery, the preview substitution,
 * and the dirty-check helpers. No DOM, no store.
 */

const REFACTOR = SEEDED_PROMPTS.find((p) => p.id === "refactor")!;
const REVIEW = SEEDED_PROMPTS.find((p) => p.id === "review")!;
const SUMMARIZE = SEEDED_PROMPTS.find((p) => p.id === "summarize")!;
const TRIAGE = SEEDED_PROMPTS.find((p) => p.id === "triage")!;

describe("discoverInputs — frontmatter", () => {
  test("reads inputs: list entries with name/type/default", () => {
    const inputs = discoverInputs(REFACTOR.source);
    expect(inputs).toEqual([
      { name: "target", type: "string", default: "src/index.ts" },
      { name: "constraints", type: "string", default: "" },
    ]);
  });

  test("frontmatter entries keep their declared default even when also interpolated", () => {
    const inputs = discoverInputs(SUMMARIZE.source);
    expect(inputs.map((i) => i.name)).toEqual(["runId", "tone"]);
    expect(inputs.find((i) => i.name === "runId")!.default).toBe("4821a0c3");
  });
});

describe("discoverInputs — body interpolations", () => {
  test("captures {props.NAME} occurrences with default type string", () => {
    const inputs = discoverInputs("Triage incoming issue {props.issue}.");
    expect(inputs).toEqual([{ name: "issue", type: "string", default: "" }]);
  });

  test("matches the whitespace variant { props.name }", () => {
    const inputs = discoverInputs("Summarize in a { props.tone } tone.");
    expect(inputs.map((i) => i.name)).toEqual(["tone"]);
  });

  test("the seeded triage prompt (no frontmatter) discovers its single body input", () => {
    const inputs = discoverInputs(TRIAGE.source);
    expect(inputs.map((i) => i.name)).toEqual(["issue"]);
  });
});

describe("discoverInputs — MDX component props", () => {
  test("captures prop={props.NAME} bindings inside component tags", () => {
    const inputs = discoverInputs(REVIEW.source);
    expect(inputs.map((i) => i.name)).toEqual(["branch", "base", "strictness", "focus"]);
  });

  test("captures a pass-through prop={prop} as an input named for the identifier", () => {
    const inputs = discoverInputs("<Tag count={count} />");
    expect(inputs.map((i) => i.name)).toEqual(["count"]);
  });
});

describe("discoverInputs — ordering & dedup", () => {
  test("frontmatter wins, then body, then MDX; dedup preserves first-seen order", () => {
    const source =
      "---\ninputs:\n  - name: a\n    default: A\n---\n" +
      "Body uses {props.b} and {props.a} again.\n" +
      "<Tag c={props.c} a={props.a} />\n";
    const inputs = discoverInputs(source);
    expect(inputs.map((i) => i.name)).toEqual(["a", "b", "c"]);
    // `a` keeps its frontmatter default despite the later body/MDX occurrences.
    expect(inputs.find((i) => i.name === "a")!.default).toBe("A");
  });

  test("default type is string when not declared", () => {
    expect(discoverInputs("{props.x}")[0].type).toBe("string");
  });
});

describe("discoverImports", () => {
  test("reads default and named ES imports plus the MDX component tags", () => {
    const imports = discoverImports(REVIEW.source);
    expect(imports).toEqual([
      { name: "Guidelines", path: "./guidelines.mdx" },
      { name: "Rubric", path: "../components/Rubric" },
    ]);
  });

  test("a component tag with no import resolves its path to an em-dash", () => {
    const imports = discoverImports("<Standalone foo={props.x} />");
    expect(imports).toEqual([{ name: "Standalone", path: "—" }]);
  });

  test("a prompt with no imports yields an empty list", () => {
    expect(discoverImports(REFACTOR.source)).toEqual([]);
  });
});

describe("renderPreview", () => {
  test("substitutes typed values for {props.NAME}", () => {
    const out = renderPreview(REFACTOR.source, { target: "auth/token.ts", constraints: "no deps" });
    expect(out).toContain("Refactor auth/token.ts for clarity.");
    expect(out).toContain("honor: no deps.");
  });

  test("falls back to the discovered default when a value is unfilled", () => {
    const out = renderPreview(REFACTOR.source, {});
    // `target` has a default, `constraints` does not → visible {NAME} placeholder.
    expect(out).toContain("Refactor src/index.ts for clarity.");
    expect(out).toContain("honor: {constraints}.");
  });

  test("substitutes the whitespace variant { props.name } too (parity fix)", () => {
    const out = renderPreview("a { props.tone } b", { tone: "concise" });
    expect(out).toBe("a concise b");
  });

  test("an empty typed value falls through to default, not blank", () => {
    const out = renderPreview(REFACTOR.source, { target: "   " });
    expect(out).toContain("Refactor src/index.ts for clarity.");
  });
});

describe("defaultValues", () => {
  test("maps each input name to its default", () => {
    expect(defaultValues(discoverInputs(REFACTOR.source))).toEqual({
      target: "src/index.ts",
      constraints: "",
    });
  });
});

describe("hasInputValueChanges", () => {
  const inputs = discoverInputs(REFACTOR.source);

  test("no typed values is not a change", () => {
    expect(hasInputValueChanges({}, inputs)).toBe(false);
  });

  test("a value equal to the default is not a change", () => {
    expect(hasInputValueChanges({ target: "src/index.ts" }, inputs)).toBe(false);
  });

  test("a value diverging from the default is a change", () => {
    expect(hasInputValueChanges({ target: "auth/token.ts" }, inputs)).toBe(true);
  });

  test("filling an input whose default is empty counts as a change", () => {
    expect(hasInputValueChanges({ constraints: "x" }, inputs)).toBe(true);
  });
});

describe("summarize", () => {
  test("reports the entryFile and discovered-input count", () => {
    expect(summarize(REFACTOR)).toEqual({ entryFile: "prompts/refactor.mdx", inputCount: 2 });
    expect(summarize(REVIEW).inputCount).toBe(4);
    expect(summarize(TRIAGE).inputCount).toBe(1);
  });
});

describe("SEEDED_PROMPTS", () => {
  test("has 3-4 deterministic entries with unique ids", () => {
    expect(SEEDED_PROMPTS.length).toBeGreaterThanOrEqual(3);
    expect(SEEDED_PROMPTS.length).toBeLessThanOrEqual(4);
    const ids = new Set(SEEDED_PROMPTS.map((p) => p.id));
    expect(ids.size).toBe(SEEDED_PROMPTS.length);
  });
});
