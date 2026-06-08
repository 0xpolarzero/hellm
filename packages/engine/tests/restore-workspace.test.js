import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { Effect } from "effect";
import * as BunContext from "@effect/platform-bun/BunContext";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { SmithersDb } from "@smithers-orchestrator/db/adapter";
import { ensureSmithersTables } from "@smithers-orchestrator/db/ensure";
import { captureWorkspaceSnapshot } from "@smithers-orchestrator/vcs/jj";
import { createSnapshotService } from "../src/snapshotService.js";
import { restoreWorkspaceToLatestCheckpoint } from "../src/restoreWorkspace.js";

function fakeAdapter(checkpoints) {
    return { async listWorkspaceCheckpoints() { return checkpoints; } };
}

describe("restoreWorkspaceToLatestCheckpoint logic (fakes)", () => {
    test("reports no-checkpoint when the node has none", async () => {
        const res = await restoreWorkspaceToLatestCheckpoint({
            adapter: fakeAdapter([{ nodeId: "other", iteration: 0, jjCommitId: "c1", jjCwd: "/wt", createdAtMs: 1, attempt: 0, seq: 0 }]),
            runId: "r1", nodeId: "n1", iteration: 0,
            revert: async () => ({ success: true }),
        });
        expect(res).toEqual({ restored: false, reason: "no-checkpoint" });
    });

    test("restores the chronologically latest checkpoint across attempts", async () => {
        const reverted = [];
        const res = await restoreWorkspaceToLatestCheckpoint({
            adapter: fakeAdapter([
                { nodeId: "n1", iteration: 0, attempt: 0, seq: 5, jjCommitId: "old", jjCwd: "/wt", createdAtMs: 10 },
                { nodeId: "n1", iteration: 0, attempt: 1, seq: 0, jjCommitId: "new", jjCwd: "/wt", createdAtMs: 20 },
            ]),
            runId: "r1", nodeId: "n1", iteration: 0,
            revert: async (commitId, cwd) => { reverted.push([commitId, cwd]); return { success: true }; },
        });
        expect(res.restored).toBe(true);
        expect(res.commitId).toBe("new");
        expect(reverted).toEqual([["new", "/wt"]]);
    });

    test("surfaces a failed revert without throwing", async () => {
        const res = await restoreWorkspaceToLatestCheckpoint({
            adapter: fakeAdapter([{ nodeId: "n1", iteration: 0, attempt: 0, seq: 0, jjCommitId: "c1", jjCwd: "/wt", createdAtMs: 1 }]),
            runId: "r1", nodeId: "n1", iteration: 0,
            revert: async () => ({ success: false, error: "commit gone" }),
        });
        expect(res.restored).toBe(false);
        expect(res.reason).toBe("revert-failed");
        expect(res.error).toBe("commit gone");
    });
});

const jjAvailable = (() => {
    try { return spawnSync("jj", ["--version"], { stdio: "ignore" }).status === 0; }
    catch { return false; }
})();
const describeIfJj = jjAvailable ? describe : describe.skip;

describeIfJj("restoreWorkspaceToLatestCheckpoint against real jj + db", () => {
    test("reverts a dirtied worktree back to its last checkpoint", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "restore-ws-"));
        try {
            expect(spawnSync("jj", ["git", "init"], { cwd: dir, encoding: "utf8" }).status).toBe(0);
            const sqlite = new Database(":memory:");
            const db = drizzle(sqlite);
            ensureSmithersTables(db);
            const adapter = new SmithersDb(db);
            const svc = createSnapshotService({
                captureSnapshot: (cwd) => Effect.runPromise(captureWorkspaceSnapshot(cwd).pipe(Effect.provide(BunContext.layer))),
                adapter,
                nowMs: () => Date.now(),
            });

            // Snapshot a known-good state.
            await fs.writeFile(path.join(dir, "work.txt"), "v1\n");
            await svc.snapshot({ runId: "r1", nodeId: "n1", iteration: 0, attempt: 0, cwd: dir, source: "hook", tier: 1 });

            // The process "crashes" mid-next-edit: dirty the tree without snapshotting.
            await fs.writeFile(path.join(dir, "work.txt"), "v2-uncommitted\n");

            const res = await restoreWorkspaceToLatestCheckpoint({ adapter, runId: "r1", nodeId: "n1", iteration: 0 });
            expect(res.restored).toBe(true);
            const after = await fs.readFile(path.join(dir, "work.txt"), "utf8");
            expect(after).toBe("v1\n");
            sqlite.close();
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
    }, 30_000);
});
