#!/usr/bin/env bun

import electrobunConfig from "../electrobun.config";
import { fileURLToPath } from "node:url";
import { E2E_EMBEDDED_BUN_PATH_ENV } from "./e2e-embedded-bun";
import { assertAppBunRuntimeVersion } from "./bun-runtime-contract";

const expectedVersion = electrobunConfig.build.bunVersion;
const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };

if (process.platform === "linux" && process.arch === "x64") {
  try {
    assertAppBunRuntimeVersion(Bun.version);
  } catch (cause) {
    throw new Error(
      `Orb runner Bun ${Bun.version} does not satisfy Electrobun build.bunVersion ${expectedVersion}.`,
      { cause },
    );
  }
  env[E2E_EMBEDDED_BUN_PATH_ENV] = process.execPath;
  console.log(
    `e2e build: embedding CPU-compatible runner Bun ${Bun.version} from ${process.execPath}`,
  );
} else if (process.platform !== "linux" || process.arch !== "arm64") {
  throw new Error(
    `The Electrobun E2E app build must run on Linux x64 or arm64; received ${process.platform}/${process.arch}.`,
  );
}

const child = Bun.spawn([process.execPath, "run", "build:dev"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await child.exited);
