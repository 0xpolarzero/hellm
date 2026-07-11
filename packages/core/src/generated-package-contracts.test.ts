import { describe, expect, it } from "bun:test";
import {
  unsafeDecodeGeneratedPackageBuildPlanResultSyncForTestsAndBootstrap,
  unsafeDecodeGeneratedWorkflowsExportBuildEvidenceSyncForTestsAndBootstrap,
} from "./generated-package-contracts";

const decodeEvidence = (input: unknown) =>
  unsafeDecodeGeneratedWorkflowsExportBuildEvidenceSyncForTestsAndBootstrap(input as never);
const decodeBuildPlan = (input: unknown) =>
  unsafeDecodeGeneratedPackageBuildPlanResultSyncForTestsAndBootstrap(input as never);

const agentEvidence = {
  kind: "agent",
  namespace: "Agents",
  exportName: "reviewerAgent",
  qualifiedName: "Agents.reviewerAgent",
  sourcePath: "/workflows/agents/reviewerAgent.agent.json",
  generatedPath: "/generated/workflows/agents/reviewerAgent.ts",
  generatedCode: "export const reviewerAgent = {};\n",
  agentParameters: {
    id: "reviewerAgent",
    label: "Reviewer",
    provider: "openai",
    model: "gpt-5.4",
    reasoning: { effort: "medium" },
    instructions: "Review the implementation.",
    overrides: { git: "loaded" },
  },
  workflowAgentId: "reviewerAgent",
} as const;

describe("generated package contracts", () => {
  it("decodes exact renderer-safe generated Workflows export evidence", () => {
    expect(decodeEvidence(agentEvidence) as unknown).toEqual(agentEvidence);

    const componentEvidence = {
      kind: "component",
      namespace: "Components",
      exportName: "ReviewSummary",
      qualifiedName: "Components.ReviewSummary",
      sourcePath: "/workflows/components/ReviewSummary.tsx",
      generatedPath: "/generated/workflows/components/ReviewSummary.tsx",
      generatedCode: "export const ReviewSummary = () => null;\n",
      agentParameters: null,
      workflowAgentId: null,
    } as const;
    expect(decodeEvidence(componentEvidence) as unknown).toEqual(componentEvidence);

    expect(
      decodeBuildPlan({
        packages: [],
        workflowsExports: [agentEvidence, componentEvidence],
      }).workflowsExports as unknown,
    ).toEqual([agentEvidence, componentEvidence]);
  });

  it("rejects mismatched namespace, qualified name, agent identity, and extra fields", () => {
    expect(() =>
      decodeEvidence({
        ...agentEvidence,
        namespace: "Components",
      }),
    ).toThrow();
    expect(() =>
      decodeEvidence({
        ...agentEvidence,
        qualifiedName: "Agents.otherAgent",
      }),
    ).toThrow();
    expect(() =>
      decodeEvidence({
        ...agentEvidence,
        workflowAgentId: "otherAgent",
      }),
    ).toThrow();
    expect(() =>
      decodeEvidence({
        ...agentEvidence,
        rendererPanelId: "panel_01",
      }),
    ).toThrow();
  });
});
