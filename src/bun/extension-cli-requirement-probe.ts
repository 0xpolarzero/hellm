import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import * as Effect from "effect/Effect";
import type {
  ExtensionCliRequirementProbeEvidence,
  ExtensionCliRequirementProbePlan,
} from "@svvy/core";
import type { ExtensionCliRequirementProbePortService } from "@svvy/extensions";

export function createExtensionCliRequirementProbeService(input: {
  readonly executableSearchPath: string;
}): ExtensionCliRequirementProbePortService {
  const searchRoots = input.executableSearchPath.split(delimiter).filter(Boolean);
  return {
    probe: (plan) => Effect.promise(() => probeExtensionCliRequirement(plan, searchRoots)),
  };
}

export async function probeExtensionCliRequirement(
  plan: ExtensionCliRequirementProbePlan,
  searchRoots: readonly string[],
): Promise<ExtensionCliRequirementProbeEvidence> {
  const executable = await resolveExecutable(plan.executable, searchRoots);
  if (!executable) return { status: "missing" };
  if (plan.probeKind === "resolve-executable") return { status: "resolved" };

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const child = spawn(executable, [...plan.argv], {
      env: { ...plan.env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const finish = (evidence: ExtensionCliRequirementProbeEvidence) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(evidence);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBoundedOutput(stdout, chunk, plan.maxStdoutBytes, () => {
        stdoutTruncated = true;
      });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBoundedOutput(stderr, chunk, plan.maxStderrBytes, () => {
        stderrTruncated = true;
      });
    });
    child.once("error", () => finish({ status: "failed" }));
    child.once("close", (exitCode) => {
      if (timedOut) {
        finish({ status: "timed-out" });
        return;
      }
      if (exitCode === null) {
        finish({ status: "failed" });
        return;
      }
      finish({
        status: "completed",
        exitCode,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        stdoutTruncated,
        stderrTruncated,
      });
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, plan.timeoutMs);
  });
}

function appendBoundedOutput(
  current: Buffer<ArrayBufferLike>,
  chunk: Buffer<ArrayBufferLike>,
  limit: number,
  markTruncated: () => void,
): Buffer<ArrayBufferLike> {
  const remaining = Math.max(0, limit - current.byteLength);
  if (chunk.byteLength > remaining) markTruncated();
  return remaining === 0 ? current : Buffer.concat([current, chunk.subarray(0, remaining)]);
}

async function resolveExecutable(
  executable: string,
  searchRoots: readonly string[],
): Promise<string | null> {
  const candidates = isAbsolute(executable)
    ? [executable]
    : executable.includes("/") || executable.includes("\\")
      ? []
      : searchRoots.map((root) => join(root, executable));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching the app-edge PATH snapshot.
    }
  }
  return null;
}
