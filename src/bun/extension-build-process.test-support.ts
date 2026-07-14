import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionBuildProcessPortService } from "@svvy/extensions";
import * as Effect from "effect/Effect";

export const successfulExtensionBuildProcessTestService: ExtensionBuildProcessPortService = {
  run: (plan) =>
    Effect.sync(() => {
      const stagedFiles = plan.expectedProcessOutputs.map((output) => {
        const contents = `test-generated:${plan.extensionId}:${output.role}:${output.relativePath}\n`;
        const bytes = Buffer.from(contents);
        const outputPath = join(plan.stagingRoot, output.relativePath);
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, bytes);
        return {
          ...output,
          contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const,
          byteSize: bytes.byteLength,
        };
      });

      return {
        status: "completed" as const,
        exitCode: 0,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        stagedFiles,
        commandManifest: null,
      };
    }),
};
