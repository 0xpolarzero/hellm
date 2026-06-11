#!/usr/bin/env bun

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = join(import.meta.dir, "..");
const manifestPath = join(projectRoot, "src", "native", "svvy-sandbox-helper", "Cargo.toml");
const cargoTargetDir = join(projectRoot, "build", "native", "cargo-target", "svvy-sandbox-helper");
const cargoOutputPath = join(cargoTargetDir, "release", "svvy-sandbox-helper");
const outputPath = join(projectRoot, "build", "native", "svvy-sandbox-helper");

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
console.log(`Built native sandbox helper at ${outputPath}`);
