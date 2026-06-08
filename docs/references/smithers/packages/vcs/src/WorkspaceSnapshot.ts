export type WorkspaceSnapshot = {
  /**
   * Working-copy commit id at this snapshot. Advances on every snapshot, so it
   * addresses an individual working-copy state (unlike `changeId`, which is
   * stable across edits to the same working copy).
   */
  commitId: string;
  /** Change id of `@`. Stable across edits to one working copy; grouping metadata only. */
  changeId: string;
  /**
   * jj operation id for this snapshot. The durable restore handle: the commit id
   * of an abandoned working-copy commit can be garbage-collected, while the
   * operation log is retained under the configured gc policy.
   */
  operationId: string;
};
