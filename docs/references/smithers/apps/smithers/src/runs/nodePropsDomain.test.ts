import { describe, expect, test } from "bun:test";
import { AUTH_REFACTOR_FRAMES } from "./authRefactorFrames";
import type { Run, RunNode } from "./Run";
import { findNode } from "./Run";
import {
  copyablePropValue,
  defaultTabFor,
  formatPropValue,
  isContainerNode,
  isPromptKey,
  nodeRoleDescription,
  pathToNode,
  PROMPT_KEYS,
  PROP_EXPAND_THRESHOLD,
  propRows,
  sideEffectLabel,
  sideEffectTone,
  tabsFor,
} from "./nodeProps";

/**
 * Pure domain tests for the node-inspector enrichment helpers: ancestry path,
 * props table rows, value formatting, prompt-key linking, side-effect badge
 * tones, and default-tab selection. No DOM, no store — exercised over the
 * deterministic AUTH_REFACTOR_FRAMES tree.
 */

const ROOT = AUTH_REFACTOR_FRAMES[2];

function fakeRun(root: RunNode): Run {
  return {
    id: "run-x",
    title: "Implement · auth refactor",
    model: "claude-opus",
    runId: "4821a0c3",
    status: root.status,
    startedAtMs: 0,
    frame: 2,
    frameCount: AUTH_REFACTOR_FRAMES.length,
    root,
  };
}

describe("pathToNode", () => {
  test("returns root → … → node, inclusive of both ends", () => {
    const path = pathToNode(ROOT, "edit-session");
    expect(path.map((n) => n.id)).toEqual(["workflow", "edit-files", "edit-session"]);
  });

  test("returns just [root] for the root id", () => {
    expect(pathToNode(ROOT, ROOT.id).map((n) => n.id)).toEqual(["workflow"]);
  });

  test("falls back to [root] for an unknown id (always at least one crumb)", () => {
    expect(pathToNode(ROOT, "nope").map((n) => n.id)).toEqual(["workflow"]);
  });

  test("the last crumb is always the requested node when present", () => {
    const target = findNode(ROOT, "edit-token")!;
    const path = pathToNode(ROOT, "edit-token");
    expect(path[path.length - 1]).toBe(target);
  });
});

describe("propRows", () => {
  const node = findNode(ROOT, "edit-files")!;
  const rows = propRows(node, fakeRun(ROOT));

  test("is sorted by key", () => {
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });

  test("carries the node facts and frame counters", () => {
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey.id).toBe("edit-files");
    expect(byKey.kind).toBe("loop");
    expect(byKey.frame).toBe(2);
    expect(byKey.frameCount).toBe(AUTH_REFACTOR_FRAMES.length);
    expect(byKey.toolCalls).toBe(node.toolCalls!.length);
  });

  test("maps node.output onto a prompt key so it auto-links", () => {
    const promptRow = rows.find((r) => r.key === "prompt")!;
    expect(promptRow.value).toBe(node.output!);
    expect(isPromptKey(promptRow.key)).toBe(true);
  });

  test("renders a missing agent as null, not undefined", () => {
    const bare: RunNode = { id: "b", name: "b", kind: "compute", status: "queued" };
    const agentRow = propRows(bare, fakeRun(ROOT)).find((r) => r.key === "agent")!;
    expect(agentRow.value).toBeNull();
  });
});

describe("formatPropValue", () => {
  test("formats each primitive with its tone", () => {
    expect(formatPropValue(null)).toEqual({ text: "null", tone: "null", expandable: false });
    expect(formatPropValue(true)).toEqual({ text: "true", tone: "bool", expandable: false });
    expect(formatPropValue(false).text).toBe("false");
    expect(formatPropValue(42)).toEqual({ text: "42", tone: "num", expandable: false });
    expect(formatPropValue("hi")).toEqual({ text: "hi", tone: "string", expandable: false });
  });

  test("flags strings past the threshold as expandable", () => {
    const long = "x".repeat(PROP_EXPAND_THRESHOLD + 1);
    expect(formatPropValue(long).expandable).toBe(true);
    const short = "x".repeat(PROP_EXPAND_THRESHOLD);
    expect(formatPropValue(short).expandable).toBe(false);
  });
});

describe("copyablePropValue", () => {
  test("strings copy verbatim, others stringify, null becomes 'null'", () => {
    expect(copyablePropValue("auth/token.ts")).toBe("auth/token.ts");
    expect(copyablePropValue(7)).toBe("7");
    expect(copyablePropValue(false)).toBe("false");
    expect(copyablePropValue(null)).toBe("null");
  });
});

describe("PROMPT_KEYS / isPromptKey", () => {
  test("includes the documented prompt aliases", () => {
    for (const k of ["prompt", "promptId", "prompt_id", "promptPath", "promptName", "promptKey", "prompt_key", "text"]) {
      expect(PROMPT_KEYS).toContain(k);
      expect(isPromptKey(k)).toBe(true);
    }
  });

  test("is case-sensitive and rejects non-prompt keys", () => {
    expect(isPromptKey("Prompt")).toBe(false);
    expect(isPromptKey("status")).toBe(false);
  });
});

describe("sideEffectTone", () => {
  test("read/none keywords tone to idle", () => {
    expect(sideEffectTone("Read")).toBe("idle");
    expect(sideEffectTone("Grep")).toBe("idle");
    expect(sideEffectTone("none")).toBe("idle");
  });

  test("write/mutate/shell/file/etc tone to waiting", () => {
    expect(sideEffectTone("Write")).toBe("waiting");
    expect(sideEffectTone("Edit")).toBe("waiting");
    expect(sideEffectTone("Bash")).toBe("waiting");
    expect(sideEffectTone("network-fetch")).toBe("waiting");
    expect(sideEffectTone("deleteFile")).toBe("waiting");
  });

  test("anything else is info", () => {
    expect(sideEffectTone("ponder")).toBe("info");
  });

  test("labels match the tone", () => {
    expect(sideEffectLabel(sideEffectTone("Write"))).toBe("writes");
    expect(sideEffectLabel(sideEffectTone("Read"))).toBe("reads");
    expect(sideEffectLabel(sideEffectTone("ponder"))).toBe("effect");
  });
});

describe("isContainerNode / nodeRoleDescription / tabsFor", () => {
  test("the workflow root and loop are containers; a compute task is not", () => {
    expect(isContainerNode(ROOT)).toBe(true);
    expect(isContainerNode(findNode(ROOT, "edit-files")!)).toBe(true);
    expect(isContainerNode(findNode(ROOT, "edit-session")!)).toBe(false);
  });

  test("container nodes describe their role; task nodes do not", () => {
    expect(nodeRoleDescription(ROOT)).toBe("Runs children in order, one after another.");
    expect(nodeRoleDescription(findNode(ROOT, "edit-files")!)).toContain("Repeats");
    expect(nodeRoleDescription(findNode(ROOT, "edit-session")!)).toBe("");
  });

  test("container nodes expose only Props; task nodes expose the full set", () => {
    expect(tabsFor(ROOT)).toEqual(["Props"]);
    expect(tabsFor(findNode(ROOT, "edit-session")!)).toEqual([
      "Output",
      "Tools",
      "Logs",
      "Diff",
      "Props",
    ]);
  });
});

describe("defaultTabFor", () => {
  test("container nodes default to Props", () => {
    expect(defaultTabFor(ROOT)).toBe("Props");
  });

  test("a task with output defaults to Output", () => {
    expect(defaultTabFor(findNode(AUTH_REFACTOR_FRAMES[2], "run-tests")!)).toBe("Output");
  });

  test("a running task with no output but tool calls defaults to Tools", () => {
    const node: RunNode = {
      id: "n",
      name: "n",
      kind: "compute",
      status: "running",
      toolCalls: [{ id: "t", verb: "Write", target: "x", status: "running" }],
    };
    expect(defaultTabFor(node)).toBe("Tools");
  });

  test("a running task with neither output nor tool calls defaults to Logs", () => {
    const node: RunNode = { id: "n", name: "n", kind: "compute", status: "running" };
    expect(defaultTabFor(node)).toBe("Logs");
  });

  test("a finished task with nothing falls back to Props", () => {
    const node: RunNode = { id: "n", name: "n", kind: "compute", status: "ok" };
    expect(defaultTabFor(node)).toBe("Props");
  });
});
