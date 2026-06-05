import { existsSync } from "node:fs";
import { resolve, dirname, parse } from "node:path";
import { Effect } from "effect";
/**
 * Walk up from `startDir` to find the nearest directory containing `.jj` or `.git`.
 * Prefers `.jj` over `.git` so colocated repos (both exist) use jj semantics.
 * Returns the VCS type and root path, or null if neither is found.
 *
 * @param {string} startDir
 * @returns {Effect.Effect<{ type: "jj"; root: string } | { type: "git"; root: string } | null, never, never>}
 */
export function findVcsRoot(startDir) {
    return Effect.sync(() => {
        let dir = resolve(startDir);
        const { root: fsRoot } = parse(dir);
        while (dir !== fsRoot) {
            if (existsSync(resolve(dir, ".jj")))
                return /** @type {{ type: "jj"; root: string }} */ ({ type: "jj", root: dir });
            if (existsSync(resolve(dir, ".git")))
                return /** @type {{ type: "git"; root: string }} */ ({ type: "git", root: dir });
            dir = dirname(dir);
        }
        if (existsSync(resolve(dir, ".jj")))
            return /** @type {{ type: "jj"; root: string }} */ ({ type: "jj", root: dir });
        if (existsSync(resolve(dir, ".git")))
            return /** @type {{ type: "git"; root: string }} */ ({ type: "git", root: dir });
        return null;
    });
}
