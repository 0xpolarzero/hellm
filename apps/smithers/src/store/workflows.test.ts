import { describe, expect, test } from "bun:test";
import { COMMANDS, type CommandId } from "../commands";
import { GRILL_EDGES, GRILL_NODES, GRILL_SYSTEM_PROMPT } from "../askme/grillMe";
import { workflowToFlow, type WorkflowSpec } from "../askme/workflowFlow";
import { STORE_WORKFLOWS, type StoreWorkflow } from "./workflows";

/**
 * Pure data-integrity checks for the workflow store catalog and the static
 * grill-me graph. These guard the invariants the UI assumes (unique ids, valid
 * commands, edges that reference real nodes) without booting React, so they
 * survive the ongoing zustand/router refactor. The known-good CommandId set
 * comes from the shared commands module rather than a hardcoded literal.
 */

const COMMAND_IDS = new Set<CommandId>(COMMANDS.map((c) => c.id));

describe("STORE_WORKFLOWS catalog", () => {
  test("is non-empty", () => {
    expect(STORE_WORKFLOWS.length).toBeGreaterThan(0);
  });

  test("every entry is well-formed per StoreWorkflow", () => {
    for (const wf of STORE_WORKFLOWS) {
      // Required string fields are present and non-blank.
      const required: Array<keyof StoreWorkflow> = [
        "id",
        "name",
        "description",
        "icon",
        "category",
        "color",
      ];
      for (const field of required) {
        expect(typeof wf[field], `${wf.id}.${field} should be a string`).toBe(
          "string",
        );
        expect((wf[field] as string).trim().length, `${wf.id}.${field} blank`).toBeGreaterThan(0);
      }
      // Accent color is a hex value the card style can consume.
      expect(wf.color, `${wf.id}.color hex`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    }
  });

  test("ids are unique", () => {
    const ids = STORE_WORKFLOWS.map((wf) => wf.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("display names are unique", () => {
    const names = STORE_WORKFLOWS.map((wf) => wf.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("each entry opens via exactly one of command or starter", () => {
    for (const wf of STORE_WORKFLOWS) {
      const hasCommand = wf.command !== undefined;
      const hasStarter = wf.starter !== undefined;
      // Opening a card must do something, and the two paths are mutually
      // exclusive (a command switches views; a starter prefills the composer).
      expect(hasCommand || hasStarter, `${wf.id} has no open action`).toBe(true);
      expect(hasCommand && hasStarter, `${wf.id} has both open actions`).toBe(false);
    }
  });

  test("command fields reference real CommandMenu views", () => {
    for (const wf of STORE_WORKFLOWS) {
      if (wf.command === undefined) continue;
      expect(COMMAND_IDS.has(wf.command), `${wf.id} → unknown command ${wf.command}`).toBe(true);
    }
  });

  test("starter prompts are non-blank when present", () => {
    for (const wf of STORE_WORKFLOWS) {
      if (wf.starter === undefined) continue;
      expect(wf.starter.trim().length, `${wf.id}.starter blank`).toBeGreaterThan(0);
    }
  });
});

describe("grill-me graph invariants", () => {
  test("GRILL_EDGES only reference ids present in GRILL_NODES", () => {
    const nodeIds = new Set(GRILL_NODES.map((n) => n.id));
    expect(nodeIds.size).toBeGreaterThan(0);
    for (const edge of GRILL_EDGES) {
      expect(nodeIds.has(edge.source), `edge ${edge.id} source ${edge.source}`).toBe(true);
      expect(nodeIds.has(edge.target), `edge ${edge.id} target ${edge.target}`).toBe(true);
    }
  });

  test("node ids are unique", () => {
    const ids = GRILL_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("includes the grilling loop-back edge", () => {
    // The loop that keeps re-grilling until requirements resolve.
    expect(GRILL_EDGES.some((e) => e.source === "grill" && e.target === "loop")).toBe(true);
  });

  test("GRILL_SYSTEM_PROMPT is non-empty", () => {
    expect(GRILL_SYSTEM_PROMPT.trim().length).toBeGreaterThan(0);
  });
});

describe("workflowToFlow", () => {
  test("turns dependsOn into forward edges and lays nodes out", () => {
    const spec: WorkflowSpec = {
      name: "linear",
      description: "two-step chain",
      nodes: [
        { id: "a", label: "A", kind: "signal", output: "x", dependsOn: [] },
        { id: "b", label: "B", kind: "agent", output: "y", dependsOn: ["a"] },
      ],
    };

    const { nodes, edges } = workflowToFlow(spec);

    // Every spec node becomes one positioned flow node carrying its spec data.
    expect(nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(nodes.every((n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y))).toBe(true);

    // The single dependency yields exactly one forward edge a->b.
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ id: "a->b", source: "a", target: "b" });
  });
});
