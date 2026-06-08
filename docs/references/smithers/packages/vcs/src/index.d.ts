import { Effect } from 'effect';
import * as _effect_platform_CommandExecutor from '@effect/platform/CommandExecutor';

/**
 * Walk up from `startDir` to find the nearest directory containing `.jj` or `.git`.
 * Prefers `.jj` over `.git` so colocated repos (both exist) use jj semantics.
 * Returns the VCS type and root path, or null if neither is found.
 *
 * @param {string} startDir
 * @returns {Effect.Effect<{ type: "jj"; root: string } | { type: "git"; root: string } | null, never, never>}
 */
declare function findVcsRoot(startDir: string): Effect.Effect<{
    type: "jj";
    root: string;
} | {
    type: "git";
    root: string;
} | null, never, never>;

type WorkspaceResult$1 = {
    success: boolean;
    error?: string;
};

type WorkspaceInfo$1 = {
    name: string;
    path: string | null;
    selected: boolean;
};

type WorkspaceAddOptions$1 = {
    cwd?: string;
    atRev?: string;
};

type RunJjResult$1 = {
    code: number;
    stdout: string;
    stderr: string;
};

type RunJjOptions$1 = {
    cwd?: string;
};

type JjRevertResult$1 = {
    success: boolean;
    error?: string;
};

/**
 * Run a `jj` command and capture output.
 * Minimal helper used by vcs features and safe to call when jj is missing.
 *
 * @param {string[]} args
 * @param {RunJjOptions} [opts]
 * @returns {Effect.Effect<RunJjResult, never, import("@effect/platform/CommandExecutor").CommandExecutor>}
 */
declare function runJj(args: string[], opts?: RunJjOptions): Effect.Effect<RunJjResult, never, _effect_platform_CommandExecutor.CommandExecutor>;
/**
 * Returns the current workspace change id (jj `change_id`) or null on failure.
 * Accepts optional `cwd` to run inside a target repository.
 *
 * @param {string} [cwd]
 * @returns {Effect.Effect<string | null, never, import("@effect/platform/CommandExecutor").CommandExecutor>}
 */
declare function getJjPointer(cwd?: string): Effect.Effect<string | null, never, _effect_platform_CommandExecutor.CommandExecutor>;
/**
 * Restore the working copy to a previously recorded jujutsu `change_id`.
 * Used by the engine to revert attempts within the correct repo/worktree (via `cwd`).
 *
 * @param {string} pointer
 * @param {string} [cwd]
 * @returns {Effect.Effect<JjRevertResult, never, import("@effect/platform/CommandExecutor").CommandExecutor>}
 */
declare function revertToJjPointer(pointer: string, cwd?: string): Effect.Effect<JjRevertResult, never, _effect_platform_CommandExecutor.CommandExecutor>;
/**
 * Quick repo detection by executing a read-only jj command.
 *
 * @param {string} [cwd]
 * @returns {Effect.Effect<boolean, never, import("@effect/platform/CommandExecutor").CommandExecutor>}
 */
declare function isJjRepo(cwd?: string): Effect.Effect<boolean, never, _effect_platform_CommandExecutor.CommandExecutor>;
/**
 * Create a new JJ workspace at `path` with a friendly `name`.
 * NOTE: Syntax may vary between JJ versions; this helper aims to be permissive.
 *
 * @param {string} name
 * @param {string} path
 * @param {WorkspaceAddOptions} [opts]
 * @returns {Effect.Effect<WorkspaceResult, never, import("@effect/platform/CommandExecutor").CommandExecutor>}
 */
declare function workspaceAdd(name: string, path: string, opts?: WorkspaceAddOptions): Effect.Effect<WorkspaceResult, never, _effect_platform_CommandExecutor.CommandExecutor>;
/**
 * List existing workspaces using a JJ template for structured output.
 * Falls back to parsing human output if `-T` is unavailable.
 *
 * @param {string} [cwd]
 * @returns {Effect.Effect<WorkspaceInfo[], never, import("@effect/platform/CommandExecutor").CommandExecutor>}
 */
declare function workspaceList(cwd?: string): Effect.Effect<WorkspaceInfo[], never, _effect_platform_CommandExecutor.CommandExecutor>;
/**
 * Close the given workspace by name.
 *
 * @param {string} name
 * @param {{ cwd?: string }} [opts]
 * @returns {Effect.Effect<WorkspaceResult, never, import("@effect/platform/CommandExecutor").CommandExecutor>}
 */
declare function workspaceClose(name: string, opts?: {
    cwd?: string;
}): Effect.Effect<WorkspaceResult, never, _effect_platform_CommandExecutor.CommandExecutor>;
type JjRevertResult = JjRevertResult$1;
type RunJjOptions = RunJjOptions$1;
type RunJjResult = RunJjResult$1;
type WorkspaceAddOptions = WorkspaceAddOptions$1;
type WorkspaceInfo = WorkspaceInfo$1;
type WorkspaceResult = WorkspaceResult$1;

/**
 * A resolved VCS executable plus where Smithers found it.
 *
 * - `env`: an explicit override (e.g. `SMITHERS_JJ_PATH`)
 * - `bundled`: a binary shipped inside a `@smithers-orchestrator/jj-<platform>` package
 * - `path`: the bare command name, left for the OS to resolve against `PATH`
 */
type ResolvedBinary$3 = {
    path: string;
    source: "env" | "bundled" | "path";
};

/** @typedef {import("./ResolvedBinary.js").ResolvedBinary} ResolvedBinary */
/**
 * Resolve the `git` executable Smithers should spawn.
 *
 * Order of preference:
 *   1. `SMITHERS_GIT_PATH` — an explicit override pointing at a real file.
 *   2. The bare `"git"`, left for the OS to resolve against `PATH`.
 *
 * Git is never bundled (only jj is); this mirrors {@link resolveJjBinary} so the
 * override and the tooling preflight share one source of truth for where git is.
 *
 * @returns {ResolvedBinary}
 */
declare function resolveGitBinary(): ResolvedBinary$2;
type ResolvedBinary$2 = ResolvedBinary$3;

/**
 * Resolve the `jj` executable Smithers should spawn.
 *
 * Order of preference:
 *   1. `SMITHERS_JJ_PATH` — an explicit override pointing at a real file.
 *   2. A binary bundled via `@smithers-orchestrator/jj-<platform>`.
 *   3. The bare `"jj"`, left for the OS to resolve against `PATH`.
 *
 * Always returns a spawnable command. When jj is genuinely absent the bare
 * `"jj"` simply fails to spawn, which `runJj` already normalizes to exit code
 * 127, so callers keep their soft-failure behavior.
 *
 * @returns {ResolvedBinary}
 */
declare function resolveJjBinary(): ResolvedBinary$1;
type ResolvedBinary$1 = ResolvedBinary$3;

/**
 * Probe whether a usable `jj` and/or `git` exists for the current host, using
 * the override → bundled → PATH resolution for jj and override → PATH for git.
 *
 * Synchronous and best-effort: used by `smithers doctor` and run preflights to
 * tell the user — before a run fails deep in worktree creation — that no VCS
 * tooling is installed, and which knob (bundled package, PATH install, or
 * `SMITHERS_JJ_PATH`) would fix it.
 *
 * @returns {VcsToolingStatus}
 */
declare function vcsToolingStatus(): VcsToolingStatus;
type ResolvedBinary = ResolvedBinary$3;
/**
 * Whether a usable `jj` and/or `git` exists for the current host. Each field is
 * the resolved binary when `<bin> --version` runs, or null when it does not.
 */
type VcsToolingStatus = {
    /**
     * a usable jj (override, bundled, or PATH), else null
     */
    jj: ResolvedBinary | null;
    /**
     * a usable git (override or PATH), else null
     */
    git: ResolvedBinary | null;
    /**
     * true when at least one of jj or git is usable
     */
    ok: boolean;
};

export { type VcsToolingStatus, findVcsRoot, getJjPointer, isJjRepo, resolveGitBinary, resolveJjBinary, revertToJjPointer, runJj, vcsToolingStatus, workspaceAdd, workspaceClose, workspaceList };
