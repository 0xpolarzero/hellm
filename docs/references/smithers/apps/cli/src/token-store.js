import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function smithersTokenStorePath() {
    return process.env.SMITHERS_TOKEN_STORE ?? resolve(process.env.HOME ?? process.cwd(), ".smithers", "tokens.json");
}

export function readSmithersTokenStore() {
    const path = smithersTokenStorePath();
    if (!existsSync(path)) {
        return { tokens: {} };
    }
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { tokens: {} };
        }
        const tokens = parsed.tokens && typeof parsed.tokens === "object" && !Array.isArray(parsed.tokens)
            ? parsed.tokens
            : {};
        return { tokens };
    }
    catch {
        return { tokens: {} };
    }
}

export function writeSmithersTokenStore(store) {
    const path = smithersTokenStorePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

export function parseTokenScopes(raw) {
    return raw
        .split(/[,\s]+/)
        .map((scope) => scope.trim())
        .filter(Boolean);
}
