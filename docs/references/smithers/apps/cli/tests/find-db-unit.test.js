import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
    findAndOpenDb,
    findSmithersDb,
    openSmithersDb,
    waitForSmithersDb,
} from "../src/find-db.js";

function tempDir(name) {
    return mkdtempSync(join(tmpdir(), `${name}-`));
}

describe("find db helpers", () => {
    test("finds smithers.db by walking up directories", () => {
        const root = tempDir("find-db");
        const nested = join(root, "a", "b");
        mkdirSync(nested, { recursive: true });
        const dbPath = join(root, "smithers.db");
        writeFileSync(dbPath, "");
        try {
            expect(findSmithersDb(nested)).toBe(dbPath);
        }
        finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test("waits for a database file and times out cleanly", async () => {
        const root = tempDir("wait-db");
        try {
            await expect(waitForSmithersDb(root, { timeoutMs: 1, intervalMs: 1 })).rejects.toMatchObject({
                code: "CLI_DB_NOT_FOUND",
            });
            await expect(waitForSmithersDb(Symbol("bad"), { timeoutMs: 1, intervalMs: 1 })).rejects.toBeInstanceOf(TypeError);

            setTimeout(() => {
                writeFileSync(join(root, "smithers.db"), "");
            }, 5);
            expect(await waitForSmithersDb(root, { timeoutMs: 100, intervalMs: 1 })).toBe(join(root, "smithers.db"));
        }
        finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test("opens a sqlite database and returns cleanup handles", async () => {
        const root = tempDir("open-db");
        const dbPath = join(root, "smithers.db");
        try {
            const opened = await openSmithersDb(dbPath);
            expect(opened.adapter).toBeTruthy();
            opened.cleanup();
            opened.cleanup();
            expect(existsSync(dbPath)).toBe(true);

            const found = await findAndOpenDb(root, { timeoutMs: 0 });
            expect(found.dbPath).toBe(dbPath);
            expect(found.adapter).toBeTruthy();
            found.cleanup();
        }
        finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
