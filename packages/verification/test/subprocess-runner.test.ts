import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import {
  createSubprocessVerificationRunner,
  normalizeVerificationRunToEpisode,
} from "@hellm/verification";
import { withTempWorkspace } from "@hellm/test-support";

describe("@hellm/verification subprocess runner", () => {
  it("writes subprocess stdout to a real file artifact for successful commands", async () => {
    await withTempWorkspace(async (workspace) => {
      const runner = createSubprocessVerificationRunner({
        buildCommand: ["echo", "build-output-line"],
      });

      const result = await runner.run({
        threadId: "thread-subprocess-build",
        cwd: workspace.root,
        objective: "Run build",
        kinds: ["build"],
      });

      expect(result.status).toBe("passed");
      expect(result.records).toHaveLength(1);
      expect(result.records[0]?.kind).toBe("build");
      expect(result.records[0]?.status).toBe("passed");

      expect(result.artifacts).toHaveLength(1);
      const artifact = result.artifacts[0]!;
      expect(artifact.kind).toBe("log");
      expect(artifact.path).toBeDefined();
      expect(existsSync(artifact.path!)).toBe(true);
      const contents = readFileSync(artifact.path!, "utf8");
      expect(contents).toContain("build-output-line");
    });
  });

  it("writes subprocess stderr to a real file artifact for failing commands", async () => {
    await withTempWorkspace(async (workspace) => {
      const runner = createSubprocessVerificationRunner({
        testCommand: ["sh", "-c", "echo test-failure-line >&2 && exit 1"],
      });

      const result = await runner.run({
        threadId: "thread-subprocess-test-fail",
        cwd: workspace.root,
        objective: "Run tests",
        kinds: ["test"],
      });

      expect(result.status).toBe("failed");
      expect(result.records).toHaveLength(1);
      expect(result.records[0]?.kind).toBe("test");
      expect(result.records[0]?.status).toBe("failed");

      expect(result.artifacts).toHaveLength(1);
      const artifact = result.artifacts[0]!;
      expect(artifact.kind).toBe("log");
      expect(artifact.path).toBeDefined();
      expect(existsSync(artifact.path!)).toBe(true);
      const contents = readFileSync(artifact.path!, "utf8");
      expect(contents).toContain("test-failure-line");
    });
  });

  it("writes lint subprocess output to a real file artifact", async () => {
    await withTempWorkspace(async (workspace) => {
      const runner = createSubprocessVerificationRunner({
        lintCommand: ["echo", "lint-passed-line"],
      });

      const result = await runner.run({
        threadId: "thread-subprocess-lint",
        cwd: workspace.root,
        objective: "Run lint",
        kinds: ["lint"],
      });

      expect(result.status).toBe("passed");
      expect(result.artifacts).toHaveLength(1);
      const artifact = result.artifacts[0]!;
      expect(existsSync(artifact.path!)).toBe(true);
      expect(readFileSync(artifact.path!, "utf8")).toContain("lint-passed-line");
    });
  });

  it("writes integration subprocess output to a real file artifact", async () => {
    await withTempWorkspace(async (workspace) => {
      const runner = createSubprocessVerificationRunner({
        integrationCommand: ["echo", "integration-result-line"],
      });

      const result = await runner.run({
        threadId: "thread-subprocess-integration",
        cwd: workspace.root,
        objective: "Run integration tests",
        kinds: ["integration"],
      });

      expect(result.status).toBe("passed");
      expect(result.artifacts).toHaveLength(1);
      const artifact = result.artifacts[0]!;
      expect(existsSync(artifact.path!)).toBe(true);
      expect(readFileSync(artifact.path!, "utf8")).toContain(
        "integration-result-line",
      );
    });
  });

  it("produces an episode referencing real file artifacts from a multi-kind subprocess run", async () => {
    await withTempWorkspace(async (workspace) => {
      const runner = createSubprocessVerificationRunner({
        buildCommand: ["echo", "build-ok"],
        lintCommand: ["echo", "lint-ok"],
        testCommand: ["sh", "-c", "echo test-fail >&2 && exit 1"],
      });

      const result = await runner.run({
        threadId: "thread-subprocess-multi",
        cwd: workspace.root,
        objective: "Run all verification",
        kinds: ["build", "lint", "test"],
      });

      expect(result.status).toBe("failed");
      expect(result.records).toHaveLength(3);

      const buildRecord = result.records.find((r) => r.kind === "build")!;
      const lintRecord = result.records.find((r) => r.kind === "lint")!;
      const testRecord = result.records.find((r) => r.kind === "test")!;

      expect(buildRecord.status).toBe("passed");
      expect(lintRecord.status).toBe("passed");
      expect(testRecord.status).toBe("failed");

      expect(result.artifacts).toHaveLength(3);
      for (const artifact of result.artifacts) {
        expect(artifact.kind).toBe("log");
        expect(artifact.path).toBeDefined();
        expect(existsSync(artifact.path!)).toBe(true);
      }

      const episode = normalizeVerificationRunToEpisode({
        threadId: "thread-subprocess-multi",
        objective: "Run all verification",
        result,
        startedAt: result.records[0]!.createdAt,
        completedAt: result.records[2]!.createdAt,
      });

      expect(episode.status).toBe("completed_with_issues");
      expect(episode.artifacts).toHaveLength(3);
      expect(episode.unresolvedIssues).toHaveLength(1);
    });
  });

  it("records unknown status when the command binary cannot be found", async () => {
    await withTempWorkspace(async (workspace) => {
      const runner = createSubprocessVerificationRunner({
        buildCommand: ["nonexistent-build-command-for-testing"],
      });

      const result = await runner.run({
        threadId: "thread-subprocess-missing",
        cwd: workspace.root,
        objective: "Run missing command",
        kinds: ["build"],
      });

      expect(result.status).toBe("unknown");
      expect(result.records).toHaveLength(1);
      expect(result.records[0]?.status).toBe("unknown");
      expect(result.records[0]?.summary).toContain("could not run");
      expect(result.artifacts).toHaveLength(0);
    });
  });
});
