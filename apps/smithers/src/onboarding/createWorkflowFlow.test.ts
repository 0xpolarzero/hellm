import { describe, expect, test } from "bun:test";
import { workflowToFlow } from "../askme/workflowFlow";
import {
  DEFAULT_TEMPLATE,
  TEMPLATES,
  classifyIntent,
  draftForGoal,
  draftToName,
  draftToStarter,
  loopBack,
  proposeWorkflow,
  type TemplateId,
} from "./createWorkflowFlow";

/**
 * Pure domain tests for the "Create a Workflow" metaworkflow: the goal→template
 * mapping and the spec it builds. No DOM, no store. The graph the overlay
 * renders leans on these invariants (every dependency resolves, the chain has a
 * trigger and a result), so they're checked directly.
 */

describe("classifyIntent", () => {
  test("routes concrete goals to the matching template", () => {
    expect(classifyIntent("review my open pull request")).toBe("review");
    expect(classifyIntent("audit the auth code")).toBe("review");
    expect(classifyIntent("reproduce and fix a failing test")).toBe("debug");
    expect(classifyIntent("the login page is broken")).toBe("debug");
    expect(classifyIntent("research how to migrate to drizzle")).toBe("research");
    expect(classifyIntent("implement a billing endpoint")).toBe("implement");
    expect(classifyIntent("add a settings component")).toBe("implement");
  });

  test("falls back to the recommended default when unsure or empty", () => {
    expect(classifyIntent("")).toBe(DEFAULT_TEMPLATE);
    expect(classifyIntent("   ")).toBe(DEFAULT_TEMPLATE);
    expect(classifyIntent("I'm not sure yet")).toBe(DEFAULT_TEMPLATE);
    expect(classifyIntent("no idea, surprise me")).toBe(DEFAULT_TEMPLATE);
    expect(classifyIntent("something cool")).toBe(DEFAULT_TEMPLATE);
  });

  test("the default is the richest template", () => {
    expect(DEFAULT_TEMPLATE).toBe("research-plan-implement");
  });
});

const ALL_TEMPLATES = Object.keys(TEMPLATES) as TemplateId[];

describe("proposeWorkflow", () => {
  test("every template yields a trigger-first, result-last, connected graph", () => {
    for (const templateId of ALL_TEMPLATES) {
      const spec = proposeWorkflow({
        goal: "do the thing",
        templateId,
        withApproval: false,
        withLoop: false,
        name: "Test",
      });
      const ids = new Set(spec.nodes.map((node) => node.id));

      const start = spec.nodes[0];
      const end = spec.nodes[spec.nodes.length - 1];
      expect(start.id).toBe("start");
      expect(start.kind).toBe("signal");
      expect(start.dependsOn).toEqual([]);
      expect(end.id).toBe("done");
      expect(end.kind).toBe("merge");

      // Every dependency resolves to a real node — the invariant the layout needs.
      for (const node of spec.nodes) {
        for (const dependency of node.dependsOn) {
          expect(ids.has(dependency)).toBe(true);
        }
      }
      // And dagre lays it out without throwing on a dangling edge.
      const flow = workflowToFlow(spec);
      expect(flow.nodes.length).toBe(spec.nodes.length);
    }
  });

  test("the approval toggle adds and removes a single approval node", () => {
    const base = draftForGoal("implement a feature");
    const withGate = proposeWorkflow({ ...base, withApproval: true });
    const noGate = proposeWorkflow({ ...base, withApproval: false });
    expect(withGate.nodes.filter((node) => node.kind === "approval").length).toBe(1);
    expect(noGate.nodes.some((node) => node.kind === "approval")).toBe(false);
    // The gate sits before the writing stage it guards.
    const gate = withGate.nodes.find((node) => node.kind === "approval")!;
    const implement = withGate.nodes.find((node) => node.id === "implement")!;
    expect(implement.dependsOn).toContain(gate.id);
  });

  test("the default workflow shows the full shape", () => {
    const spec = proposeWorkflow(draftForGoal(""));
    const labels = spec.nodes.map((node) => node.id);
    expect(labels).toContain("research");
    expect(labels).toContain("plan");
    expect(labels).toContain("implement");
    expect(labels).toContain("review");
  });
});

describe("loopBack", () => {
  test("returns an edge only when the toggle is on and the template loops", () => {
    const rpi = draftForGoal(""); // unsure → research-plan-implement
    expect(rpi.templateId).toBe("research-plan-implement");
    expect(loopBack({ ...rpi, withLoop: false })).toBeNull();
    expect(loopBack({ ...rpi, withLoop: true })).toEqual({
      from: "review",
      to: "implement",
      label: "needs work",
    });
    // Read-only templates have nothing to loop, even with the toggle on.
    const review = draftForGoal("review my PR");
    expect(loopBack({ ...review, withLoop: true })).toBeNull();
  });
});

describe("draft helpers", () => {
  test("draftToName derives a short title from the goal, else the template label", () => {
    expect(draftToName(draftForGoal("ship the new billing page"))).toBe("Ship New Billing Page");
    expect(draftToName(draftForGoal(""))).toBe(TEMPLATES[DEFAULT_TEMPLATE].label);
  });

  test("draftToStarter prefixes the template starter and carries the goal", () => {
    const draft = draftForGoal("add dark mode");
    const starter = draftToStarter(draft);
    expect(starter.startsWith(TEMPLATES.implement.starter)).toBe(true);
    expect(starter).toContain("add dark mode");
  });

  test("draftForGoal defaults the approval gate on for writing templates only", () => {
    expect(draftForGoal("implement a feature").withApproval).toBe(true);
    expect(draftForGoal("fix a bug").withApproval).toBe(true);
    expect(draftForGoal("review my PR").withApproval).toBe(false);
    expect(draftForGoal("research the spec").withApproval).toBe(false);
  });
});
