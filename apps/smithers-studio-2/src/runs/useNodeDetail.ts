import { useEffect, useRef, useState } from "react";
import { runsGatewayClient } from "./runsGatewayClient";
import type { NodeDiff, NodeOutput } from "./runState";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseOutput(payload: unknown): NodeOutput {
  const record = asRecord(payload);
  return {
    status: typeof record.status === "string" ? record.status : undefined,
    row: record.row,
    schema: record.schema,
  };
}

function parseDiff(payload: unknown): NodeDiff {
  const record = asRecord(payload);
  const summary = asRecord(record.summary);
  // The real gateway getNodeDiff returns a DiffBundle ({seq, baseRef, patches:
  // [{path, diff}]}); the stat variant returns {summary, files}. Accept either:
  // prefer `files`, else fold `patches`.
  const rawFiles = Array.isArray(record.files)
    ? record.files
    : Array.isArray(record.patches)
      ? record.patches
      : [];
  const files = rawFiles.map((entry) => {
    const file = asRecord(entry);
    return {
      path: String(file.path ?? file.filePath ?? "file"),
      patch: typeof file.patch === "string" ? file.patch : typeof file.diff === "string" ? file.diff : undefined,
    };
  });
  return {
    summary: { filesChanged: typeof summary.filesChanged === "number" ? summary.filesChanged : files.length },
    files,
  };
}

export type NodeDetail = {
  output: NodeOutput | undefined;
  diff: NodeDiff | undefined;
  loading: boolean;
  error: string | undefined;
};

/**
 * Lazily fetch a node's output + diff for the inspector. Both are loaded
 * together when the selected node changes; failures (e.g. NodeHasNoOutput) are
 * surfaced as a soft error string rather than throwing, since "no output yet"
 * is a normal state for a running node.
 */
export function useNodeDetail(
  runId: string | undefined,
  nodeId: string | undefined,
  iteration: number | undefined,
): NodeDetail {
  const client = runsGatewayClient();
  const [output, setOutput] = useState<NodeOutput>();
  const [diff, setDiff] = useState<NodeDiff>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const generationRef = useRef(0);

  useEffect(() => {
    if (!runId || !nodeId) {
      setOutput(undefined);
      setDiff(undefined);
      setError(undefined);
      return;
    }
    const generation = ++generationRef.current;
    setLoading(true);
    setError(undefined);
    // The gateway requires an explicit iteration (it rejects undefined as
    // InvalidIteration). Use the node's REAL current iteration from the
    // snapshot; only fall back to 0 for structural nodes that carry no task
    // iteration at all (where the first iteration is the only one).
    const targetIteration = typeof iteration === "number" ? iteration : 0;
    void (async () => {
      const [outputResult, diffResult] = await Promise.allSettled([
        client.rpc("getNodeOutput", { runId, nodeId, iteration: targetIteration }),
        client.rpc("getNodeDiff", { runId, nodeId, iteration: targetIteration }),
      ]);
      if (generation !== generationRef.current) return;
      setOutput(outputResult.status === "fulfilled" ? parseOutput(outputResult.value) : undefined);
      setDiff(diffResult.status === "fulfilled" ? parseDiff(diffResult.value) : undefined);
      if (outputResult.status === "rejected" && diffResult.status === "rejected") {
        setError("No output or diff available for this node yet.");
      }
      setLoading(false);
    })();
  }, [client, runId, nodeId, iteration]);

  return { output, diff, loading, error };
}
