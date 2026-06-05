import type { RunNode } from "./runState";

/** Depth-first search for a node by id within a run tree. */
export function findNode(tree: RunNode | null, nodeId: string | undefined): RunNode | undefined {
  if (!tree || !nodeId) return undefined;
  if (tree.id === nodeId) return tree;
  for (const child of tree.children) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return undefined;
}
