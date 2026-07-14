import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type {
  ExtensionBuildFileEvidence,
  ExtensionBuildProcessEvidence,
  ExtensionBuildProcessPlan,
} from "@svvy/core";
import { decodeUnknownSvvyxCommandManifestExit } from "@svvy/core";
import type { ExtensionBuildProcessPortService } from "@svvy/extensions";
import { EXTENSION_BUILD_RUNTIME_HELPER_SOURCE } from "./extension-build-runtime-helper";

export function createExtensionBuildProcessService(input: {
  readonly executable: string;
  readonly env: Readonly<Record<string, string>>;
}): ExtensionBuildProcessPortService {
  const env = { ...input.env };
  return {
    run: (plan) =>
      Effect.promise(() => runExtensionBuildProcess(plan, { executable: input.executable, env })),
  };
}

export async function runExtensionBuildProcess(
  plan: ExtensionBuildProcessPlan,
  host: {
    readonly executable: string;
    readonly env: Readonly<Record<string, string>>;
  },
): Promise<ExtensionBuildProcessEvidence> {
  try {
    if (!isAbsolute(host.executable)) return failed("validation");
    const sourceRoot = await realpath(plan.sourceRoot);
    const stagingRoot = await realpath(plan.stagingRoot);
    const generatedOutputs = new Set<string>();
    const validatedGenerators: Array<{
      readonly scriptPath: string;
      readonly outputPath: string;
      readonly argv: readonly string[];
    }> = [];
    const expectedOutputs = new Set<string>();
    for (const output of plan.expectedProcessOutputs) {
      if (!canonicalRelativePath(output.relativePath) || expectedOutputs.has(output.relativePath))
        return failed("validation");
      expectedOutputs.add(output.relativePath);
    }
    for (const generator of plan.generators) {
      lexicalContained(plan.sourceRoot, generator.scriptPath);
      const scriptPath = await realContainedFile(sourceRoot, await realpath(generator.scriptPath));
      const lexicalOutputPath = lexicalContained(plan.stagingRoot, generator.outputPath);
      const relativeOutput = relative(resolve(plan.stagingRoot), lexicalOutputPath)
        .split(sep)
        .join("/");
      lexicalContained(stagingRoot, resolve(stagingRoot, relativeOutput));
      if (!expectedOutputs.has(relativeOutput) || generatedOutputs.has(relativeOutput))
        return failed("validation");
      generatedOutputs.add(relativeOutput);
      validatedGenerators.push({ ...generator, scriptPath });
    }

    if (plan.svvyxRuntime) {
      lexicalContained(plan.sourceRoot, plan.svvyxRuntime.sourcePath);
      await realContainedFile(sourceRoot, await realpath(plan.svvyxRuntime.sourcePath));
      const lexicalRuntimeOutput = lexicalContained(
        plan.stagingRoot,
        plan.svvyxRuntime.runtimeOutputPath,
      );
      const runtimeRelative = relative(resolve(plan.stagingRoot), lexicalRuntimeOutput)
        .split(sep)
        .join("/");
      lexicalContained(stagingRoot, resolve(stagingRoot, runtimeRelative));
      if (!expectedOutputs.has(runtimeRelative) || generatedOutputs.has(runtimeRelative))
        return failed("validation");
      generatedOutputs.add(runtimeRelative);
    }

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const deadline = Date.now() + plan.timeoutMs;
    for (const generator of validatedGenerators) {
      await mkdir(dirname(generator.outputPath), { recursive: true });
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return { status: "timed-out" };
      const result = await runGenerator({
        executable: host.executable,
        argv: [generator.scriptPath, ...generator.argv],
        cwd: sourceRoot,
        env: host.env,
        timeoutMs: remainingMs,
        stdoutLimit: plan.maxStdoutBytes - stdout.byteLength,
        stderrLimit: plan.maxStderrBytes - stderr.byteLength,
      });
      if (result.status !== "completed") return result;
      stdout = Buffer.concat([stdout, result.stdout]);
      stderr = Buffer.concat([stderr, result.stderr]);
      stdoutTruncated ||= result.stdoutTruncated;
      stderrTruncated ||= result.stderrTruncated;
      if (result.exitCode !== 0) {
        return {
          status: "completed",
          exitCode: result.exitCode,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          stdoutTruncated,
          stderrTruncated,
          stagedFiles: [],
          commandManifest: null,
        };
      }
    }

    let commandManifest = null;
    if (plan.svvyxRuntime) {
      await mkdir(dirname(plan.svvyxRuntime.runtimeOutputPath), { recursive: true });
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return { status: "timed-out" };
      const helper = await runGenerator({
        executable: host.executable,
        argv: [
          "--eval",
          EXTENSION_BUILD_RUNTIME_HELPER_SOURCE,
          JSON.stringify({
            sourcePath: plan.svvyxRuntime.sourcePath,
            outputDirectory: dirname(plan.svvyxRuntime.runtimeOutputPath),
            runtimeOutputPath: plan.svvyxRuntime.runtimeOutputPath,
            incurPath: Bun.resolveSync("incur", import.meta.dir),
            maxManifestBytes: plan.maxStdoutBytes,
          }),
        ],
        cwd: sourceRoot,
        env: host.env,
        timeoutMs: remainingMs,
        stdoutLimit: plan.maxStdoutBytes,
        stderrLimit: Math.max(0, plan.maxStderrBytes - stderr.byteLength),
      });
      if (helper.status !== "completed") return helper;
      stderr = Buffer.concat([stderr, helper.stderr]);
      stderrTruncated ||= helper.stderrTruncated;
      if (helper.exitCode !== 0) return failed("runtime-helper");
      let protocol: unknown;
      try {
        protocol = JSON.parse(helper.stdout.toString("utf8"));
      } catch {
        return failed("runtime-protocol");
      }
      if (!isRecord(protocol) || protocol.ok !== true) return failed("runtime-protocol");
      const decoded = decodeUnknownSvvyxCommandManifestExit(protocol.commandManifest);
      if (Exit.isFailure(decoded)) return failed("runtime-protocol");
      commandManifest = decoded.value;
    }

    const actualFiles = await listRegularFiles(stagingRoot);
    if (
      actualFiles.length !== expectedOutputs.size ||
      actualFiles.some((relativePath) => !expectedOutputs.has(relativePath))
    )
      return failed("output-verification");

    const stagedFiles: ExtensionBuildFileEvidence[] = [];
    for (const output of plan.expectedProcessOutputs) {
      const outputPath = resolve(stagingRoot, output.relativePath);
      await realContainedFile(stagingRoot, outputPath);
      const bytes = await readFile(outputPath);
      stagedFiles.push({
        ...output,
        contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        byteSize: bytes.byteLength,
      });
    }
    return {
      status: "completed",
      exitCode: 0,
      stdout: stdout.toString("utf8"),
      stderr: stderr.toString("utf8"),
      stdoutTruncated,
      stderrTruncated,
      stagedFiles,
      commandManifest,
    };
  } catch {
    return failed("validation");
  }
}

type ExtensionBuildProcessFailureStage =
  | "validation"
  | "spawn"
  | "runtime-helper"
  | "runtime-protocol"
  | "output-verification";

type FailedExtensionBuildProcessEvidence = {
  readonly status: "failed";
  readonly stage: ExtensionBuildProcessFailureStage;
};

function failed(stage: ExtensionBuildProcessFailureStage): FailedExtensionBuildProcessEvidence {
  return { status: "failed", stage };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function listRegularFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      lexicalContained(root, path);
      if (entry.isSymbolicLink()) throw new Error("Staged output contains a symbolic link.");
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) throw new Error("Staged output is not a regular file.");
      files.push(relative(root, path).split(sep).join("/"));
    }
  };
  await visit(root);
  return files.toSorted();
}

async function runGenerator(input: {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly stdoutLimit: number;
  readonly stderrLimit: number;
}): Promise<
  | {
      status: "completed";
      exitCode: number;
      stdout: Buffer;
      stderr: Buffer;
      stdoutTruncated: boolean;
      stderrTruncated: boolean;
    }
  | { status: "timed-out" }
  | FailedExtensionBuildProcessEvidence
> {
  return new Promise((finish) => {
    let settled = false;
    let timedOut = false;
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const child = spawn(input.executable, [...input.argv], {
      cwd: input.cwd,
      env: { ...input.env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const complete = (result: Awaited<ReturnType<typeof runGenerator>>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      finish(result);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      const appended = appendBounded(stdout, chunk, input.stdoutLimit);
      stdout = appended.output;
      stdoutTruncated ||= appended.truncated;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const appended = appendBounded(stderr, chunk, input.stderrLimit);
      stderr = appended.output;
      stderrTruncated ||= appended.truncated;
    });
    child.once("error", () => complete(failed("spawn")));
    child.once("close", (exitCode) => {
      if (timedOut) return complete({ status: "timed-out" });
      if (exitCode === null) return complete(failed("spawn"));
      complete({
        status: "completed",
        exitCode,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
      });
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);
  });
}

function appendBounded(
  current: Buffer<ArrayBufferLike>,
  chunk: Buffer<ArrayBufferLike>,
  limit: number,
) {
  const remaining = Math.max(0, limit - current.byteLength);
  return {
    output: remaining === 0 ? current : Buffer.concat([current, chunk.subarray(0, remaining)]),
    truncated: chunk.byteLength > remaining,
  };
}

async function realContainedFile(root: string, candidate: string): Promise<string> {
  const lexical = lexicalContained(root, candidate);
  const info = await lstat(lexical);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Expected a regular file.");
  const canonical = await realpath(lexical);
  lexicalContained(root, canonical);
  return canonical;
}

function lexicalContained(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const child = relative(resolvedRoot, resolvedCandidate);
  if (child === "" || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw new Error("Extension build path escapes its assigned root.");
  return resolvedCandidate;
}

function canonicalRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}
