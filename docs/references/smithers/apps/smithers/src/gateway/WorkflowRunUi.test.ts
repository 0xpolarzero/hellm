import { describe, expect, test } from "bun:test";
import { workflowUiSrc } from "./WorkflowRunUi";

describe("workflowUiSrc", () => {
  test("keeps same-origin iframe paths relative for the gateway proxy", () => {
    expect(workflowUiSrc("/workflows/demo-ui", "run-1", "")).toBe(
      "/workflows/demo-ui?runId=run-1",
    );
  });

  test("uses an absolute remote gateway origin when configured", () => {
    expect(
      workflowUiSrc("/workflows/demo-ui?theme=dark", "run 1", "https://gateway.example.com/base"),
    ).toBe("https://gateway.example.com/workflows/demo-ui?theme=dark&runId=run+1");
  });

  test("does not allow protocol-relative ui paths to escape the gateway origin", () => {
    expect(
      workflowUiSrc("//evil.example/workflows/pwn?theme=dark", "run-1", "https://gateway.example.com"),
    ).toBe("https://gateway.example.com/workflows/pwn?theme=dark&runId=run-1");
  });

  test("uses only the path from absolute ui urls", () => {
    expect(
      workflowUiSrc("https://evil.example/workflows/pwn#panel", "run-1", "https://gateway.example.com"),
    ).toBe("https://gateway.example.com/workflows/pwn?runId=run-1#panel");
  });
});
