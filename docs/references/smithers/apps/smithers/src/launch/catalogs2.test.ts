import { describe, expect, test } from "bun:test";
import { MEMORY_FACTS, type MemoryFact } from "../memory/memoryFacts";
import { PROMPT_TEMPLATES, type PromptTemplate } from "../prompts/promptTemplates";
import { LAUNCHABLES, type LaunchField, type Launchable } from "./launchables";

/**
 * Static-catalog invariants for the three slash-command card sources: memory
 * facts (/memory), prompt templates (/prompts), launchables (/launch,
 * /research, /implement). These feed CardView with no runtime input, so the
 * cards are only as trustworthy as the arrays — each must be non-empty, have
 * unique ids/keys, and be well-formed per its exported type.
 */

/** Every id in a catalog must be present and collide with nothing else. */
function expectUniqueIds(ids: string[]): void {
  for (const id of ids) {
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  }
  expect(new Set(ids).size).toBe(ids.length);
}

describe("MEMORY_FACTS", () => {
  test("is non-empty", () => {
    expect(MEMORY_FACTS.length).toBeGreaterThan(0);
  });

  test("ids are unique and non-empty", () => {
    expectUniqueIds(MEMORY_FACTS.map((fact) => fact.id));
  });

  test("each fact is well-formed per MemoryFact", () => {
    for (const fact of MEMORY_FACTS) {
      // Structural shape: id/namespace/text are filled strings.
      expect(typeof fact.namespace).toBe("string");
      expect(fact.namespace.length).toBeGreaterThan(0);
      expect(typeof fact.text).toBe("string");
      expect(fact.text.length).toBeGreaterThan(0);
      // weight is the recall base score: a finite number in [0, 1].
      expect(typeof fact.weight).toBe("number");
      expect(Number.isFinite(fact.weight)).toBe(true);
      expect(fact.weight).toBeGreaterThanOrEqual(0);
      expect(fact.weight).toBeLessThanOrEqual(1);
      // Keep the compiler honest about the element type.
      const typed: MemoryFact = fact;
      expect(typed).toBe(fact);
    }
  });
});

describe("PROMPT_TEMPLATES", () => {
  test("is non-empty", () => {
    expect(PROMPT_TEMPLATES.length).toBeGreaterThan(0);
  });

  test("ids are unique and non-empty", () => {
    expectUniqueIds(PROMPT_TEMPLATES.map((template) => template.id));
  });

  test("each template is well-formed per PromptTemplate", () => {
    for (const template of PROMPT_TEMPLATES) {
      expect(typeof template.name).toBe("string");
      expect(template.name.length).toBeGreaterThan(0);
      expect(typeof template.field).toBe("string");
      expect(template.field.length).toBeGreaterThan(0);
      expect(typeof template.body).toBe("string");
      // Every body carries the single {target} fill slot fillTemplate replaces.
      expect(template.body).toContain("{target}");
      const typed: PromptTemplate = template;
      expect(typed).toBe(template);
    }
  });
});

describe("LAUNCHABLES", () => {
  const FIELD_TYPES = new Set<LaunchField["type"]>(["text", "area", "select"]);

  test("is non-empty", () => {
    expect(LAUNCHABLES.length).toBeGreaterThan(0);
  });

  test("ids are unique and non-empty", () => {
    expectUniqueIds(LAUNCHABLES.map((entry) => entry.id));
  });

  test("each launchable is well-formed per Launchable", () => {
    for (const entry of LAUNCHABLES) {
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.blurb).toBe("string");
      expect(entry.blurb.length).toBeGreaterThan(0);
      // A launchable with no fields would render an empty form.
      expect(Array.isArray(entry.fields)).toBe(true);
      expect(entry.fields.length).toBeGreaterThan(0);
      const typed: Launchable = entry;
      expect(typed).toBe(entry);
    }
  });

  test("field keys are unique within each launchable", () => {
    for (const entry of LAUNCHABLES) {
      expectUniqueIds(entry.fields.map((field) => field.key));
    }
  });

  test("each field is well-formed per LaunchField", () => {
    for (const entry of LAUNCHABLES) {
      for (const field of entry.fields) {
        expect(typeof field.label).toBe("string");
        expect(field.label.length).toBeGreaterThan(0);
        expect(FIELD_TYPES.has(field.type)).toBe(true);
        // select fields drive a dropdown, so they must ship options.
        if (field.type === "select") {
          expect(Array.isArray(field.options)).toBe(true);
          expect(field.options!.length).toBeGreaterThan(0);
        }
        const typed: LaunchField = field;
        expect(typed).toBe(field);
      }
    }
  });
});
