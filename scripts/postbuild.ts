#!/usr/bin/env bun

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveElectrobunAppCodeDir } from "electrobun-e2e/electrobun-paths";

const buildDir = process.env.ELECTROBUN_BUILD_DIR;
const appName = process.env.ELECTROBUN_APP_NAME;

if (!buildDir || !appName) {
  console.error("postbuild: ELECTROBUN_BUILD_DIR and ELECTROBUN_APP_NAME env vars required");
  process.exit(1);
}

const appCodeDir = resolveElectrobunAppCodeDir(buildDir, appName);
const nodeModulesDest = join(appCodeDir, "node_modules");
const projectRoot = join(import.meta.dir, "..");
const src = (rel: string) => join(projectRoot, "node_modules", rel);

const scopes = [
  "@rivet-dev",
  "@secure-exec",
  "@esbuild",
  "@mariozechner",
  "@agentclientprotocol",
  "@smithers-orchestrator",
];

const packages = [
  "secure-exec",
  "node-stdlib-browser",
  "esbuild",
  "web-streams-polyfill",
  "cbor-x",
  "cjs-module-lexer",
  "es-module-lexer",
  "pkg-dir",
  "better-sqlite3",
  "pyodide",
  "react",
  "react-dom",
  "smithers-orchestrator",
  "zod",
];

type PackageManifest = {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

const pendingPackages: string[] = [];
const seenPackages = new Set<string>();
let copied = 0;

function enqueuePackage(packageName: string): void {
  if (seenPackages.has(packageName)) {
    return;
  }
  seenPackages.add(packageName);
  pendingPackages.push(packageName);
}

function readPackageManifest(packageName: string): PackageManifest | null {
  const manifestPath = join(src(packageName), "package.json");
  if (!existsSync(manifestPath)) {
    return null;
  }

  return JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
}

function copyPackage(packageName: string): void {
  const source = src(packageName);
  if (!existsSync(source)) {
    console.warn(`postbuild: skipping package ${packageName} (not found)`);
    return;
  }

  const destination = join(nodeModulesDest, packageName);
  mkdirSync(join(destination, ".."), { recursive: true });
  cpSync(source, destination, { recursive: true, dereference: true });
  copied += 1;
}

for (const scope of scopes) {
  const scopeSrc = src(scope);
  if (!existsSync(scopeSrc)) {
    console.warn(`postbuild: skipping scope ${scope}/ (not found)`);
    continue;
  }

  for (const entry of readdirSync(scopeSrc)) {
    enqueuePackage(`${scope}/${entry}`);
  }
}

for (const packageName of packages) {
  enqueuePackage(packageName);
}

while (pendingPackages.length > 0) {
  const packageName = pendingPackages.shift();
  if (!packageName) {
    continue;
  }

  copyPackage(packageName);

  const manifest = readPackageManifest(packageName);
  const dependencyNames = Object.keys({
    ...manifest?.dependencies,
    ...manifest?.optionalDependencies,
  });
  for (const dependencyName of dependencyNames) {
    enqueuePackage(dependencyName);
  }
}

console.log(`postbuild: copied ${copied} packages to bundle`);
