import type {
  SelectWorkspaceLayoutSlotCommandInput,
  SelectWorkspaceTabCommandInput,
  SetWorkspaceTabsCommandInput,
} from "@svvy/state";

export type WorkspaceChromeMutation =
  | { kind: "set-tabs"; input: SetWorkspaceTabsCommandInput }
  | { kind: "select-tab"; input: SelectWorkspaceTabCommandInput }
  | { kind: "select-layout-slot"; input: SelectWorkspaceLayoutSlotCommandInput };

export interface WorkspaceChromeMutationQueue {
  enqueue(
    mutation: WorkspaceChromeMutation,
    onRejected?: (error: unknown) => Promise<void> | void,
  ): Promise<void>;
  runTracked<T>(operation: () => Promise<T>): Promise<T>;
  drain(): Promise<void>;
}

export function createWorkspaceChromeMutationQueue(
  execute: (mutation: WorkspaceChromeMutation) => Promise<unknown>,
): WorkspaceChromeMutationQueue {
  let tail: Promise<void> = Promise.resolve();
  const trackedSettlements = new Set<Promise<void>>();
  return {
    enqueue(mutation, onRejected) {
      const captured = structuredClone(mutation);
      const result = tail.then(async () => {
        try {
          await execute(captured);
        } catch (error) {
          await onRejected?.(error);
          throw error;
        }
      });
      tail = result.catch(() => undefined);
      return result;
    },
    runTracked(operation) {
      const result = Promise.resolve().then(operation);
      let settlement!: Promise<void>;
      settlement = result
        .then(
          () => undefined,
          () => undefined,
        )
        .finally(() => trackedSettlements.delete(settlement));
      trackedSettlements.add(settlement);
      return result;
    },
    async drain() {
      while (true) {
        const capturedTail = tail;
        const capturedSettlements = [...trackedSettlements];
        await Promise.all([capturedTail, ...capturedSettlements]);
        if (capturedTail === tail && trackedSettlements.size === 0) return;
      }
    },
  };
}
