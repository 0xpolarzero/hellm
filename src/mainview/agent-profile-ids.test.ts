import { describe, expect, it } from "bun:test";
import { isValidWorkflowExportName } from "../shared/workflows-export-name";
import { createWorkflowAgentId } from "./agent-profile-ids";

describe("workflow agent ids", () => {
  it("generates TypeScript export-safe ids for duplicated workflow agents", () => {
    const id = createWorkflowAgentId("Explorer copy", ["explorer", "implementer", "reviewer"]);

    expect(id).toBe("explorerCopy");
    expect(isValidWorkflowExportName(id)).toBe(true);
    expect(id).not.toContain("-");
  });

  it("keeps generated ids unique without adding hyphens", () => {
    const id = createWorkflowAgentId("Explorer copy", [
      "explorer",
      "implementer",
      "reviewer",
      "explorerCopy",
    ]);

    expect(id).toBe("explorerCopy2");
    expect(isValidWorkflowExportName(id)).toBe(true);
  });

  it("prefixes labels that would otherwise start with a number", () => {
    const id = createWorkflowAgentId("123 review", []);

    expect(id).toBe("workflowAgent123Review");
    expect(isValidWorkflowExportName(id)).toBe(true);
  });
});
