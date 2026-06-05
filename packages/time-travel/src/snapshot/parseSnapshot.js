import { parseSnapshotJson } from "./parseSnapshotJson.js";
/** @typedef {import("../ParsedSnapshot.ts").ParsedSnapshot} ParsedSnapshot */
/** @typedef {import("./Snapshot.ts").Snapshot} Snapshot */
/**
 * @param {Snapshot} snapshot
 * @returns {ParsedSnapshot}
 */
export function parseSnapshot(snapshot) {
    const ctx = { runId: snapshot.runId, frameNo: snapshot.frameNo };
    const nodesArr = parseSnapshotJson(snapshot.nodesJson, "nodesJson", ctx);
    const nodes = {};
    for (const n of nodesArr) {
        nodes[`${n.nodeId}::${n.iteration}`] = n;
    }
    const ralphArr = parseSnapshotJson(snapshot.ralphJson, "ralphJson", ctx);
    const ralph = {};
    for (const r of ralphArr) {
        ralph[r.ralphId] = r;
    }
    return {
        runId: snapshot.runId,
        frameNo: snapshot.frameNo,
        nodes,
        outputs: parseSnapshotJson(snapshot.outputsJson, "outputsJson", ctx),
        ralph,
        input: parseSnapshotJson(snapshot.inputJson, "inputJson", ctx),
        vcsPointer: snapshot.vcsPointer,
        workflowHash: snapshot.workflowHash,
        contentHash: snapshot.contentHash,
        createdAtMs: snapshot.createdAtMs,
    };
}
