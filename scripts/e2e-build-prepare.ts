import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, readlink, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

export const E2E_BUILD_INPUT_FINGERPRINT_PATH = ".svvy-e2e-build-inputs.sha256";
export const E2E_RUNNER_BUILD_STAMP_PATH = join("build", ".electrobun-e2e-build-stamp");

export type E2EBuildPreparationResult = "changed" | "unchanged";

export interface E2EBuildPreparationOptions {
  buildInputPaths: readonly string[];
  fingerprintPath?: string;
  log?: (message: string) => void;
  projectRoot: string;
  runnerBuildStampPath?: string;
}

export async function fingerprintBuildInputs(
  projectRoot: string,
  buildInputPaths: readonly string[],
): Promise<string> {
  const hash = createHash("sha256");

  for (const inputPath of new Set(buildInputPaths).values().toArray().toSorted()) {
    const absolutePath = resolve(projectRoot, inputPath);
    const label = relative(projectRoot, absolutePath).replaceAll("\\", "/");
    await hashBuildInputPath(absolutePath, label, hash);
  }

  return hash.digest("hex");
}

export async function prepareE2EBuildInputs(
  options: E2EBuildPreparationOptions,
): Promise<E2EBuildPreparationResult> {
  const fingerprintPath =
    options.fingerprintPath ?? join(options.projectRoot, E2E_BUILD_INPUT_FINGERPRINT_PATH);
  const runnerBuildStampPath =
    options.runnerBuildStampPath ?? join(options.projectRoot, E2E_RUNNER_BUILD_STAMP_PATH);
  const fingerprint = await fingerprintBuildInputs(options.projectRoot, options.buildInputPaths);
  const previous = await readFile(fingerprintPath, "utf8").catch((error: unknown) => {
    if (isFileNotFoundError(error)) return null;
    throw error;
  });

  if (previous?.trim() === fingerprint) {
    options.log?.("E2E build inputs unchanged after OrbStack sync.");
    return "unchanged";
  }

  await rm(runnerBuildStampPath, { force: true });
  await writeFingerprintRecord(fingerprintPath, fingerprint);
  options.log?.("E2E build inputs changed after OrbStack sync; forcing an app rebuild.");
  return "changed";
}

async function hashBuildInputPath(
  absolutePath: string,
  label: string,
  hash: ReturnType<typeof createHash>,
): Promise<void> {
  const info = await lstat(absolutePath).catch((error: unknown) => {
    if (isFileNotFoundError(error)) return null;
    throw error;
  });
  if (!info) {
    hash.update(`missing\0${label}\0`);
    return;
  }

  if (info.isSymbolicLink()) {
    hash.update(`symlink\0${label}\0${await readlink(absolutePath)}\0`);
    return;
  }
  if (info.isFile()) {
    hash.update(`file\0${label}\0${info.mode}\0`);
    hash.update(await readFile(absolutePath));
    hash.update("\0");
    return;
  }
  if (info.isDirectory()) {
    hash.update(`directory\0${label}\0${info.mode}\0`);
    const entries = await readdir(absolutePath);
    for (const entry of entries.toSorted()) {
      await hashBuildInputPath(join(absolutePath, entry), `${label}/${entry}`, hash);
    }
    return;
  }

  hash.update(`other\0${label}\0${info.mode}\0${info.size}\0`);
}

async function writeFingerprintRecord(path: string, fingerprint: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${fingerprint}\n`);
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function installDependencies(projectRoot: string): Promise<void> {
  const process = Bun.spawn(["bun", "install", "--frozen-lockfile"], {
    cwd: projectRoot,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`bun install --frozen-lockfile failed with exit code ${exitCode}.`);
  }
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  await installDependencies(projectRoot);

  const module = (await import("../electrobun-e2e.config")) as {
    default?: { buildInputPaths?: readonly string[] };
  };
  const buildInputPaths = module.default?.buildInputPaths ?? [];
  await prepareE2EBuildInputs({
    buildInputPaths,
    projectRoot,
    log: (message) => console.log(message),
  });
}

if (import.meta.main) {
  await main();
}
