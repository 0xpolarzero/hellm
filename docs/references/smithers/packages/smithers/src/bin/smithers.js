#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOW_PATH_COMMANDS = new Set([
    "up",
    "graph",
    "fork",
    "replay",
    "revert",
    "timetravel",
]);
const WORKFLOW_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".mts"]);

/**
 * @param {string} value
 */
function isOptionLike(value) {
    return value.startsWith("-");
}

/**
 * @param {string} value
 */
function looksLikeWorkflowPath(value) {
    if (isOptionLike(value))
        return false;
    return WORKFLOW_EXTENSIONS.has(parse(value).ext);
}

/**
 * @param {string[]} args
 */
function getExplicitWorkflowPath(args) {
    if (args.length === 0)
        return null;
    if (looksLikeWorkflowPath(args[0]))
        return args[0];
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (!WORKFLOW_PATH_COMMANDS.has(arg))
            continue;
        for (let nextIndex = index + 1; nextIndex < args.length; nextIndex++) {
            const candidate = args[nextIndex];
            if (looksLikeWorkflowPath(candidate))
                return candidate;
        }
        return null;
    }
    for (const arg of args) {
        if (looksLikeWorkflowPath(arg))
            return arg;
    }
    return null;
}

/**
 * Resolve the local `smithers-orchestrator` package's bin JS file under
 * `<directory>/node_modules/`. Going through `package.json` (instead of the
 * `.bin/smithers` shell shim npm/pnpm generate) is the whole point: the shim
 * is `#!/bin/sh` and re-execing it with `process.execPath` (bun) makes bun
 * parse shell as JavaScript, which crashes with `Expected ")" but found
 * "$(echo "`.
 *
 * @param {string} directory
 */
function resolveLocalSmithersBinJs(directory) {
    const pkgJsonPath = resolve(directory, "node_modules/smithers-orchestrator/package.json");
    if (!existsSync(pkgJsonPath))
        return null;
    let pkg;
    try {
        pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    } catch {
        return null;
    }
    const binEntry = typeof pkg?.bin === "string" ? pkg.bin : pkg?.bin?.smithers;
    if (typeof binEntry !== "string" || binEntry.length === 0)
        return null;
    const binPath = resolve(dirname(pkgJsonPath), binEntry);
    return existsSync(binPath) ? binPath : null;
}

/**
 * @param {string} cwd
 * @param {string} workflowPath
 */
function findNearestWorkflowLocalCli(cwd, workflowPath) {
    let current = dirname(resolve(cwd, workflowPath));
    while (true) {
        const localBin = resolveLocalSmithersBinJs(current);
        if (localBin)
            return localBin;
        const parent = dirname(current);
        if (parent === current)
            return null;
        current = parent;
    }
}

/**
 * When a workflow directory (`.smithers/`) exists in the user's cwd and it's
 * installed a local `smithers` bin, re-exec against that instead of this
 * globally-resolved copy. This is the same pattern `tsc` uses for local
 * TypeScript installs: every module the workflow runtime touches — engine,
 * react-reconciler, components, React itself — comes from a single tree,
 * which avoids the "two React copies → null useContext dispatcher" trap that
 * bunx and `.smithers/` would otherwise produce (bunx temp dir + local
 * `.smithers/node_modules/` each install their own React).
 */
function delegateToLocalCliIfPresent() {
    const cwd = process.cwd();
    const workflowPath = getExplicitWorkflowPath(process.argv.slice(2));
    const workflowLocalBin = workflowPath
        ? findNearestWorkflowLocalCli(cwd, workflowPath)
        : null;
    const localBin = workflowLocalBin ?? resolveLocalSmithersBinJs(resolve(cwd, ".smithers"));
    if (!localBin)
        return false;
    const selfPath = realpathSync(fileURLToPath(import.meta.url));
    const localTarget = realpathSync(localBin);
    if (localTarget === selfPath)
        return false;
    const proc = spawn(process.execPath, [localTarget, ...process.argv.slice(2)], {
        stdio: "inherit",
        cwd,
    });
    proc.on("exit", (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        else process.exit(code ?? 0);
    });
    return true;
}

if (!delegateToLocalCliIfPresent()) {
    await import("@smithers-orchestrator/cli");
}
