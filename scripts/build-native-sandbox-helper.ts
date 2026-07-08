#!/usr/bin/env bun

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = join(import.meta.dir, "..");
const manifestPath = join(projectRoot, "src", "native", "svvy-sandbox-helper", "Cargo.toml");
const cargoTargetDir = join(projectRoot, "build", "native", "cargo-target", "svvy-sandbox-helper");
const cargoOutputPath = join(cargoTargetDir, "release", "svvy-sandbox-helper");
const outputPath = join(projectRoot, "build", "native", "svvy-sandbox-helper");
const metadataPath = join(projectRoot, "build", "native", "svvy-sandbox-helper.metadata.json");

type NativeSandboxHelperMetadata = {
  schemaVersion: 1;
  artifact: "svvy-sandbox-helper";
  platform: "darwin";
  arch: "arm64" | "x64";
  digest: {
    algorithm: "sha256";
    hex: string;
  };
};

if (process.platform !== "darwin") {
  process.exit(0);
}

mkdirSync(dirname(outputPath), { recursive: true });

const result = spawnSync(
  "cargo",
  ["build", "--release", "--manifest-path", manifestPath, "--target-dir", cargoTargetDir],
  {
    cwd: projectRoot,
    stdio: "inherit",
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!existsSync(cargoOutputPath)) {
  console.error(`Native sandbox helper build did not produce ${cargoOutputPath}`);
  process.exit(1);
}

copyFileSync(cargoOutputPath, outputPath);
writeFileSync(
  metadataPath,
  `${JSON.stringify(nativeSandboxHelperMetadata(outputPath), null, 2)}\n`,
);
console.log(`Built native sandbox helper at ${outputPath}`);

function nativeSandboxHelperMetadata(path: string): NativeSandboxHelperMetadata {
  return {
    schemaVersion: 1,
    artifact: "svvy-sandbox-helper",
    platform: "darwin",
    arch: currentArch(),
    digest: {
      algorithm: "sha256",
      hex: createHash("sha256").update(readFileSync(path)).digest("hex"),
    },
  };
}

function currentArch(): "arm64" | "x64" {
  if (process.arch === "arm64" || process.arch === "x64") {
    return process.arch;
  }
  console.error(`Native sandbox helper build does not support architecture ${process.arch}.`);
  process.exit(1);
}
