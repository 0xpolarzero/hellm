import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { ensureSmithersTables } from "@smithers-orchestrator/db/ensure";
import { SmithersDb } from "@smithers-orchestrator/db/adapter";
import { SmithersError } from "@smithers-orchestrator/errors/SmithersError";
import { Cause, Effect, Exit } from "effect";
import { parseSnapshot } from "../src/snapshot/index.js";
import { forkRunEffect } from "../src/fork/index.js";
import { smithersSnapshots } from "../src/schema.js";

function createTestDb() {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite);
    ensureSmithersTables(db);
    return { adapter: new SmithersDb(db), db, sqlite };
}

/**
 * Insert a snapshot row directly, bypassing serialization, so individual JSON
 * columns can be corrupted to simulate a damaged persisted row.
 *
 * @param {SmithersDb} adapter
 * @param {string} runId
 * @param {number} frameNo
 * @param {Partial<Record<"nodesJson"|"outputsJson"|"ralphJson"|"inputJson", string>>} [overrides]
 */
async function insertSnapshotRow(adapter, runId, frameNo, overrides = {}) {
    const row = {
        runId,
        frameNo,
        nodesJson: "[]",
        outputsJson: "{}",
        ralphJson: "[]",
        inputJson: "{}",
        vcsPointer: null,
        workflowHash: null,
        contentHash: "hash",
        createdAtMs: 1,
        ...overrides,
    };
    await adapter.db.insert(smithersSnapshots).values(row);
}

describe("parseSnapshot with malformed JSON", () => {
    test("throws SmithersError (not raw SyntaxError) for corrupt nodesJson", async () => {
        const { adapter } = createTestDb();
        await insertSnapshotRow(adapter, "run-1", 0, { nodesJson: "{not json" });
        const snap = await adapter.db
            .select()
            .from(smithersSnapshots)
            .then((rows) => rows[0]);
        let caught;
        try {
            parseSnapshot(snap);
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(SmithersError);
        expect(caught).not.toBeInstanceOf(SyntaxError);
    });

    test("throws SmithersError for corrupt ralphJson, outputsJson, inputJson", async () => {
        const { adapter } = createTestDb();
        for (const col of ["ralphJson", "outputsJson", "inputJson"]) {
            await insertSnapshotRow(adapter, `run-${col}`, 0, { [col]: "<<<bad" });
            const snap = await adapter.db
                .select()
                .from(smithersSnapshots)
                .then((rows) => rows.find((r) => r.runId === `run-${col}`));
            let caught;
            try {
                parseSnapshot(snap);
            } catch (err) {
                caught = err;
            }
            expect(caught).toBeInstanceOf(SmithersError);
        }
    });
});

describe("forkRun with malformed JSON", () => {
    test("surfaces a typed SmithersError when inputOverrides hits corrupt inputJson", async () => {
        const { adapter } = createTestDb();
        await insertSnapshotRow(adapter, "parent", 0, { inputJson: "not-json" });
        const exit = await Effect.runPromiseExit(
            forkRunEffect(adapter, {
                parentRunId: "parent",
                frameNo: 0,
                inputOverrides: { extra: true },
            }),
        );
        // The fork Effect must FAIL with a typed SmithersError, never DIE with a
        // raw SyntaxError defect.
        expect(Exit.isFailure(exit)).toBe(true);
        const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : undefined;
        const err = failure && failure._tag === "Some" ? failure.value : undefined;
        expect(err).toBeInstanceOf(SmithersError);
        expect(err.summary).toContain("Corrupt snapshot data");
    });

    test("surfaces a typed SmithersError when resetNodes hits corrupt nodesJson", async () => {
        const { adapter } = createTestDb();
        await insertSnapshotRow(adapter, "parent", 0, { nodesJson: "not-json" });
        const exit = await Effect.runPromiseExit(
            forkRunEffect(adapter, {
                parentRunId: "parent",
                frameNo: 0,
                resetNodes: ["analyze"],
            }),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : undefined;
        const err = failure && failure._tag === "Some" ? failure.value : undefined;
        expect(err).toBeInstanceOf(SmithersError);
        expect(err.summary).toContain("Corrupt snapshot data");
    });
});
