#!/usr/bin/env bun

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { resolveElectrobunAppCodeDir } from "electrobun-e2e/electrobun-paths";
import electrobunConfig from "../electrobun.config";
import { installE2EEmbeddedBun } from "./e2e-embedded-bun";

const buildDir = process.env.ELECTROBUN_BUILD_DIR;
const appName = process.env.ELECTROBUN_APP_NAME;
const buildEnv = process.env.ELECTROBUN_BUILD_ENV;

if (!buildDir || !appName) {
  console.error("postbuild: ELECTROBUN_BUILD_DIR and ELECTROBUN_APP_NAME env vars required");
  process.exit(1);
}

const appCodeDir = resolveElectrobunAppCodeDir(buildDir, appName);
const nodeModulesDest = join(appCodeDir, "node_modules");
const projectRoot = join(import.meta.dir, "..");
const nodeModulesSource = join(projectRoot, "node_modules");
const src = (rel: string) => join(projectRoot, "node_modules", rel);
const nativeWindowControlsLibrary = join(
  projectRoot,
  "build",
  "native",
  "libSvvyWindowControls.dylib",
);
const nativeSandboxHelper = join(projectRoot, "build", "native", "svvy-sandbox-helper");
const nativeSandboxHelperMetadata = join(
  projectRoot,
  "build",
  "native",
  "svvy-sandbox-helper.metadata.json",
);
const generatedInstructionAssets = join(projectRoot, "generated", "instructions", "full");
const packagedExtensionTemplates = join(projectRoot, "packages", "extensions", "src", "builtin");
const generatedInstructionScripts = [
  "generate-api-declarations.ts",
  "generate-cx-skill.ts",
  "generate-smithers-fragment.ts",
  "generate-tinyfish-cli.ts",
];

function copyGeneratedInstructionAssets(): void {
  if (!existsSync(generatedInstructionAssets)) {
    console.error(
      `postbuild: missing generated instruction assets at ${generatedInstructionAssets}`,
    );
    process.exit(1);
  }
  const appContentsDir = join(appCodeDir, "..", "..");
  const destination = join(appContentsDir, "MacOS", "generated", "instructions", "full");
  mkdirSync(destination, { recursive: true });
  cpSync(generatedInstructionAssets, destination, { recursive: true });
}

function copyPackagedExtensionTemplates(): void {
  if (!existsSync(packagedExtensionTemplates)) {
    console.error(
      `postbuild: missing packaged extension templates at ${packagedExtensionTemplates}`,
    );
    process.exit(1);
  }
  const appContentsDir = join(appCodeDir, "..", "..");
  const destination = join(appContentsDir, "MacOS", "generated", "extensions", "builtin");
  mkdirSync(destination, { recursive: true });
  cpSync(packagedExtensionTemplates, destination, { recursive: true });
}

function copyGeneratedInstructionScripts(): void {
  const appContentsDir = join(appCodeDir, "..", "..");
  const destination = join(appContentsDir, "MacOS", "scripts");
  mkdirSync(destination, { recursive: true });
  for (const script of generatedInstructionScripts) {
    const source = join(projectRoot, "scripts", script);
    if (!existsSync(source)) {
      console.error(`postbuild: missing generated instruction script at ${source}`);
      process.exit(1);
    }
    cpSync(source, join(destination, script));
  }
}

function ensureNativeWindowControlsLibrary(): void {
  if (process.platform !== "darwin") return;

  const result = spawnSync(
    process.execPath,
    [join(projectRoot, "scripts", "build-native-window-controls.ts")],
    {
      cwd: projectRoot,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function copyNativeWindowControlsLibrary(): void {
  if (process.platform !== "darwin") return;

  ensureNativeWindowControlsLibrary();
  if (!existsSync(nativeWindowControlsLibrary)) {
    console.error(
      `postbuild: missing native window-controls library at ${nativeWindowControlsLibrary}`,
    );
    process.exit(1);
  }

  const appContentsDir = join(appCodeDir, "..", "..");
  cpSync(nativeWindowControlsLibrary, join(appContentsDir, "MacOS", "libSvvyWindowControls.dylib"));
}

function ensureNativeSandboxHelper(): void {
  if (process.platform !== "darwin") return;

  const result = spawnSync(
    process.execPath,
    [join(projectRoot, "scripts", "build-native-sandbox-helper.ts")],
    {
      cwd: projectRoot,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function copyNativeSandboxHelper(): void {
  if (process.platform !== "darwin") return;

  ensureNativeSandboxHelper();
  if (!existsSync(nativeSandboxHelper)) {
    console.error(`postbuild: missing native sandbox helper at ${nativeSandboxHelper}`);
    process.exit(1);
  }
  if (!existsSync(nativeSandboxHelperMetadata)) {
    console.error(
      `postbuild: missing native sandbox helper metadata at ${nativeSandboxHelperMetadata}`,
    );
    process.exit(1);
  }

  const appContentsDir = join(appCodeDir, "..", "..");
  const macOsDir = join(appContentsDir, "MacOS");
  cpSync(nativeSandboxHelper, join(macOsDir, "svvy-sandbox-helper"));
  cpSync(nativeSandboxHelperMetadata, join(macOsDir, "svvy-sandbox-helper.metadata.json"));
}

if (buildEnv === "dev") {
  const embeddedBunReceipt = await installE2EEmbeddedBun({
    appName,
    buildDir,
    buildEnv,
    expectedVersion: electrobunConfig.build.bunVersion,
    sourcePath: process.env.SVVY_E2E_EMBEDDED_BUN_PATH,
    targetArch: process.env.ELECTROBUN_ARCH,
    targetOS: process.env.ELECTROBUN_OS,
  });
  if (embeddedBunReceipt) {
    const receiptPath = join(buildDir, appName, "e2e-embedded-bun.json");
    writeFileSync(receiptPath, `${JSON.stringify(embeddedBunReceipt, null, 2)}\n`);
    console.log(`postbuild: embedded E2E runner Bun ${JSON.stringify(embeddedBunReceipt)}`);
  }
  mkdirSync(appCodeDir, { recursive: true });
  if (!existsSync(nodeModulesDest)) {
    symlinkSync(nodeModulesSource, nodeModulesDest, "dir");
  }
  copyNativeWindowControlsLibrary();
  copyNativeSandboxHelper();
  copyGeneratedInstructionAssets();
  copyGeneratedInstructionScripts();
  copyPackagedExtensionTemplates();
  console.log("postbuild: linked repo node_modules into dev bundle");
  process.exit(0);
}

const scopes = ["@rivet-dev", "@secure-exec", "@esbuild", "@mariozechner", "@agentclientprotocol"];

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

copyNativeWindowControlsLibrary();
copyNativeSandboxHelper();
copyGeneratedInstructionAssets();
copyGeneratedInstructionScripts();
copyPackagedExtensionTemplates();
console.log(`postbuild: copied ${copied} packages to bundle`);
