import { SmithersError } from "@smithers-orchestrator/errors/SmithersError";
import { join, resolve } from "node:path";
import { accountsRoot } from "./accountsRoot.js";

/**
 * Account labels are used as a path segment under `~/.smithers/accounts`, so
 * they must be a single, safe segment. This mirrors the wizard's input regex
 * (`agentAddWizard.js`) and rejects anything that could escape the accounts
 * root (`..`, `/`, `\`, etc.).
 */
const LABEL_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Default location for a per-account CLI config dir, e.g.
 * `~/.smithers/accounts/claude-work`.
 *
 * @param {string} label
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function defaultConfigDir(label, env = process.env) {
    if (typeof label !== "string" || !LABEL_PATTERN.test(label) || label === "." || label === "..") {
        throw new SmithersError(
            "ACCOUNT_INVALID",
            `Invalid account label ${JSON.stringify(label)}: use only letters, digits, '.', '_' or '-' (no path separators or '..').`,
        );
    }
    const root = accountsRoot(env);
    const dir = join(root, "accounts", label);
    // Defense-in-depth: a valid label can never escape, but assert the resolved
    // path stays under the accounts root so a future regex change can't silently
    // reintroduce traversal.
    const base = resolve(root, "accounts");
    const resolved = resolve(dir);
    if (resolved !== join(base, label) && !resolved.startsWith(base + "/")) {
        throw new SmithersError(
            "ACCOUNT_INVALID",
            `Invalid account label ${JSON.stringify(label)}: resolved path escapes the accounts directory.`,
        );
    }
    return dir;
}
