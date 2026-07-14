import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, createReadStream, existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { assertAppBunRuntimeVersion } from "./bun-runtime-contract";

export const E2E_EMBEDDED_BUN_PATH_ENV = "SVVY_E2E_EMBEDDED_BUN_PATH";

export interface E2EEmbeddedBunBuildContext {
  appName?: string;
  buildDir?: string;
  buildEnv?: string;
  expectedVersion: string;
  sourcePath?: string;
  targetArch?: string;
  targetOS?: string;
}

export interface E2EEmbeddedBunReceipt {
  destinationPath: string;
  sha256: string;
  sourcePath: string;
  sourceSha256: string;
  revision: string;
  version: string;
}

interface E2EEmbeddedBunDependencies {
  readRevision?: (executablePath: string) => Promise<string>;
  readVersion?: (executablePath: string) => Promise<string>;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

export async function readBunExecutableVersion(executablePath: string): Promise<string> {
  const child = Bun.spawn([executablePath, "--version"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `E2E embedded Bun version probe failed for ${executablePath} (${exitCode}): ${stderr.trim()}`,
    );
  }

  const version = stdout.trim();
  if (!version) {
    throw new Error(`E2E embedded Bun version probe returned no version for ${executablePath}.`);
  }
  return version;
}

export async function readBunExecutableRevision(executablePath: string): Promise<string> {
  const child = Bun.spawn([executablePath, "--revision"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `E2E embedded Bun revision probe failed for ${executablePath} (${exitCode}): ${stderr.trim()}`,
    );
  }
  const revision = stdout.trim();
  if (!revision) {
    throw new Error(`E2E embedded Bun revision probe returned no revision for ${executablePath}.`);
  }
  return revision;
}

export async function installE2EEmbeddedBun(
  context: E2EEmbeddedBunBuildContext,
  dependencies: E2EEmbeddedBunDependencies = {},
): Promise<E2EEmbeddedBunReceipt | null> {
  const sourcePath = context.sourcePath?.trim();
  if (!sourcePath) return null;

  if (context.buildEnv !== "dev") {
    throw new Error(
      `${E2E_EMBEDDED_BUN_PATH_ENV} is restricted to Electrobun dev builds; received ${String(context.buildEnv)}.`,
    );
  }
  if (context.targetOS !== "linux" || context.targetArch !== "x64") {
    throw new Error(
      `${E2E_EMBEDDED_BUN_PATH_ENV} requires an Electrobun linux/x64 target; received ${String(context.targetOS)}/${String(context.targetArch)}.`,
    );
  }
  if (!context.buildDir || !context.appName) {
    throw new Error(
      `${E2E_EMBEDDED_BUN_PATH_ENV} requires ELECTROBUN_BUILD_DIR and ELECTROBUN_APP_NAME.`,
    );
  }
  if (!isAbsolute(sourcePath)) {
    throw new Error(`${E2E_EMBEDDED_BUN_PATH_ENV} must be an absolute path: ${sourcePath}`);
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`${E2E_EMBEDDED_BUN_PATH_ENV} does not exist: ${sourcePath}`);
  }

  const sourceStat = statSync(sourcePath);
  if (!sourceStat.isFile()) {
    throw new Error(`${E2E_EMBEDDED_BUN_PATH_ENV} must identify a regular file: ${sourcePath}`);
  }
  if ((sourceStat.mode & 0o111) === 0) {
    throw new Error(`${E2E_EMBEDDED_BUN_PATH_ENV} is not executable: ${sourcePath}`);
  }

  const readVersion = dependencies.readVersion ?? readBunExecutableVersion;
  const readRevision = dependencies.readRevision ?? readBunExecutableRevision;
  const version = await readVersion(sourcePath);
  const revision = await readRevision(sourcePath);
  try {
    if (context.expectedVersion === "canary") {
      assertAppBunRuntimeVersion(version);
      if (!revision.includes("-canary.")) {
        throw new Error(`Bun revision ${revision} is not an official canary build.`);
      }
    } else if (version !== context.expectedVersion) {
      throw new Error(`expected Bun ${context.expectedVersion}`);
    }
  } catch (cause) {
    throw new Error(
      `E2E runner Bun ${version} does not match Electrobun build.bunVersion ${context.expectedVersion}.`,
      { cause },
    );
  }

  const destinationPath = join(context.buildDir, context.appName, "bin", "bun");
  if (!existsSync(destinationPath)) {
    throw new Error(`Electrobun embedded Bun destination does not exist: ${destinationPath}`);
  }

  const sourceSha256 = await sha256File(sourcePath);
  copyFileSync(sourcePath, destinationPath);
  chmodSync(destinationPath, sourceStat.mode & 0o777);
  const destinationSha256 = await sha256File(destinationPath);

  if (destinationSha256 !== sourceSha256) {
    throw new Error(
      `E2E embedded Bun digest mismatch after copy: ${sourceSha256} != ${destinationSha256}.`,
    );
  }

  return {
    destinationPath,
    sha256: destinationSha256,
    sourcePath,
    sourceSha256,
    revision,
    version,
  };
}
