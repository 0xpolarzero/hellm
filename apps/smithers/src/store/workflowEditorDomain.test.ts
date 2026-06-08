import { describe, expect, test } from "bun:test";
import {
  applyLaunchDefaults,
  changedFileCount,
  findWorkflowDoc,
  inputPipeline,
  runDoctor,
  summarizeDoctor,
  validateLaunch,
  validateLaunchField,
  WORKFLOW_DOCS,
  type LaunchField,
  type WorkflowDoc,
} from "./workflowDocs";

/**
 * Pure domain tests for the workflow editor: the launch-input validator, the
 * deterministic doctor, the DAG/pipeline derivation, the dirty-file counter, and
 * the default-application helper the store leans on. No DOM, no store.
 */

const FIELD_STRING: LaunchField = { key: "task", type: "string", required: true };
const FIELD_NUMBER: LaunchField = { key: "depth", type: "number", required: false };
const FIELD_BOOL: LaunchField = { key: "force", type: "boolean", required: false };
const FIELD_OBJECT: LaunchField = { key: "opts", type: "object", required: false };
const FIELD_ARRAY: LaunchField = { key: "items", type: "array", required: false };
const FIELD_JSON: LaunchField = { key: "payload", type: "json", required: true };

describe("seed integrity", () => {
  test("every doc is keyed to a unique id with matching original source", () => {
    const ids = WORKFLOW_DOCS.map((doc) => doc.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const doc of WORKFLOW_DOCS) {
      expect(doc.source).toBe(doc.originalSource);
      expect(doc.filePath).toContain(".smithers/workflows/");
    }
  });

  test("findWorkflowDoc resolves by id and is null-safe", () => {
    expect(findWorkflowDoc(WORKFLOW_DOCS, "implement")?.name).toBe("Implement");
    expect(findWorkflowDoc(WORKFLOW_DOCS, "nope")).toBeNull();
    expect(findWorkflowDoc(WORKFLOW_DOCS, null)).toBeNull();
  });
});

describe("validateLaunchField", () => {
  test("required + empty is an error, optional + empty passes", () => {
    expect(validateLaunchField(FIELD_STRING, "")).toBe("task is required.");
    expect(validateLaunchField(FIELD_STRING, "   ")).toBe("task is required.");
    expect(validateLaunchField(FIELD_NUMBER, "")).toBeNull();
  });

  test("number rejects non-numeric and accepts numeric", () => {
    expect(validateLaunchField(FIELD_NUMBER, "abc")).toBe(
      'depth must be a number. "abc" is not valid.',
    );
    expect(validateLaunchField(FIELD_NUMBER, "3")).toBeNull();
    expect(validateLaunchField(FIELD_NUMBER, "-2.5")).toBeNull();
  });

  test("string and boolean accept any non-empty value", () => {
    expect(validateLaunchField(FIELD_STRING, "do the thing")).toBeNull();
    expect(validateLaunchField(FIELD_BOOL, "true")).toBeNull();
  });

  test("object requires a JSON object shape", () => {
    expect(validateLaunchField(FIELD_OBJECT, "{}")).toBeNull();
    expect(validateLaunchField(FIELD_OBJECT, '{"a":1}')).toBeNull();
    expect(validateLaunchField(FIELD_OBJECT, "[1,2]")).toBe("opts must be a JSON object.");
    expect(validateLaunchField(FIELD_OBJECT, "not json")).toBe("opts must be a JSON object.");
    expect(validateLaunchField(FIELD_OBJECT, "null")).toBe("opts must be a JSON object.");
  });

  test("array requires a JSON array shape", () => {
    expect(validateLaunchField(FIELD_ARRAY, "[]")).toBeNull();
    expect(validateLaunchField(FIELD_ARRAY, "[1,2,3]")).toBeNull();
    expect(validateLaunchField(FIELD_ARRAY, "{}")).toBe("items must be a JSON array.");
    expect(validateLaunchField(FIELD_ARRAY, "oops")).toBe("items must be a JSON array.");
  });

  test("json accepts any valid JSON and flags required-empty + parse failures", () => {
    expect(validateLaunchField(FIELD_JSON, '{"a":1}')).toBeNull();
    expect(validateLaunchField(FIELD_JSON, "42")).toBeNull();
    expect(validateLaunchField(FIELD_JSON, "")).toBe("payload is required.");
    expect(validateLaunchField(FIELD_JSON, "{bad")).toBe("payload must be valid JSON.");
  });
});

describe("validateLaunch", () => {
  test("returns only the failing fields, empty when all valid", () => {
    const fields = [FIELD_STRING, FIELD_NUMBER];
    expect(validateLaunch(fields, { task: "x", depth: "2" })).toEqual({});
    expect(validateLaunch(fields, { task: "", depth: "nope" })).toEqual({
      task: "task is required.",
      depth: 'depth must be a number. "nope" is not valid.',
    });
  });

  test("treats a missing key the same as empty", () => {
    expect(validateLaunch([FIELD_STRING], {})).toEqual({ task: "task is required." });
  });
});

describe("applyLaunchDefaults", () => {
  const fields: LaunchField[] = [
    { key: "a", type: "string", required: false, defaultValue: "alpha" },
    { key: "b", type: "number", required: false, defaultValue: "2" },
    { key: "c", type: "string", required: false }, // no default
  ];

  test("overwrite:true sets every default, ignores fields without one", () => {
    const out = applyLaunchDefaults(fields, { a: "edited" }, { overwrite: true });
    expect(out).toEqual({ a: "alpha", b: "2" });
  });

  test("overwrite:false keeps user edits but fills blanks/missing", () => {
    const out = applyLaunchDefaults(fields, { a: "edited", b: "" }, { overwrite: false });
    expect(out.a).toBe("edited");
    expect(out.b).toBe("2");
  });
});

describe("changedFileCount", () => {
  const doc = findWorkflowDoc(WORKFLOW_DOCS, "implement")!;

  test("zero when drafts match the originals", () => {
    const importDrafts: Record<string, string> = {};
    for (const file of doc.imports) importDrafts[file.path] = file.source;
    expect(changedFileCount(doc, doc.source, importDrafts)).toBe(0);
  });

  test("counts a dirty source and each dirty import", () => {
    const importDrafts: Record<string, string> = {};
    for (const file of doc.imports) importDrafts[file.path] = file.source;
    importDrafts[doc.imports[0].path] = "// edited";
    expect(changedFileCount(doc, doc.source + "\n// edit", importDrafts)).toBe(2);
  });
});

describe("runDoctor", () => {
  test("is deterministic per workflow id (same issues twice)", () => {
    const doc = findWorkflowDoc(WORKFLOW_DOCS, "implement")!;
    expect(runDoctor(doc)).toEqual(runDoctor(doc));
  });

  test("reports an explicit entry task as reachable for implement", () => {
    const doc = findWorkflowDoc(WORKFLOW_DOCS, "implement")!;
    const issues = runDoctor(doc);
    expect(issues.some((i) => i.severity === "ok" && i.message.includes("Entry task"))).toBe(true);
  });

  test("flags an empty source as an error", () => {
    const doc: WorkflowDoc = { ...findWorkflowDoc(WORKFLOW_DOCS, "review")!, source: "" };
    const issues = runDoctor(doc);
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });

  test("flags an inferred DAG with an info note", () => {
    const doc = findWorkflowDoc(WORKFLOW_DOCS, "research-plan-implement")!;
    const issues = runDoctor(doc);
    expect(issues.some((i) => i.severity === "info" && i.message.includes("inferred"))).toBe(true);
  });

  test("summarizeDoctor totals match the issue list", () => {
    const doc = findWorkflowDoc(WORKFLOW_DOCS, "implement")!;
    const issues = runDoctor(doc);
    const summary = summarizeDoctor(issues);
    expect(summary.ok + summary.warning + summary.error + summary.info).toBe(issues.length);
  });
});

describe("inputPipeline", () => {
  test("is empty when the DAG already has nodes", () => {
    const doc = findWorkflowDoc(WORKFLOW_DOCS, "implement")!;
    expect(inputPipeline(doc)).toEqual([]);
  });

  test("chains field keys to the entry when there are nodes but we force-empty", () => {
    const base = findWorkflowDoc(WORKFLOW_DOCS, "research-plan-implement")!;
    const doc: WorkflowDoc = { ...base, dag: { ...base.dag, nodes: [] } };
    expect(inputPipeline(doc)).toEqual(["query", "depth", base.dag.entry]);
  });
});
