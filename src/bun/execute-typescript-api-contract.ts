/**
 * Source of truth for the `execute_typescript` prompt contract.
 *
 * The build regenerates an ambient `.d.ts` file from this module and embeds that
 * declaration source into the default system prompt. Keep the runtime behavior
 * and the JSDoc here aligned.
 */

/**
 * Console methods available inside an `execute_typescript` snippet.
 *
 * Logged output is captured and returned in the tool result. Use this for small
 * debugging notes rather than for the main semantic result.
 */
export interface SvvyConsole {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * UTF-8 text file content loaded from the workspace.
 */
export interface RepoTextFile {
  /** Workspace-relative path that was read. */
  path: string;
  /** Full UTF-8 file contents. */
  text: string;
}

/**
 * Result of writing a workspace file.
 */
export interface RepoWriteResult {
  /** Workspace-relative path that was written. */
  path: string;
  /** Number of UTF-8 bytes written. */
  bytes: number;
}

/**
 * Workspace file or directory metadata.
 */
export interface RepoStat {
  /** Workspace-relative path that was inspected. */
  path: string;
  /** Whether the path exists inside the workspace root. */
  exists: boolean;
  /** Resolved kind for the inspected path. */
  kind: "file" | "directory" | "missing";
  /** Present for existing files and directories. */
  sizeBytes?: number;
}

/**
 * One grep hit from a workspace search.
 */
export interface RepoGrepMatch {
  /** Workspace-relative file path containing the match. */
  path: string;
  /** 1-based line number for the matching line. */
  line: number;
  /** Full line text for the match. */
  text: string;
}

/**
 * One file entry from `api.git.status()`.
 */
export interface GitFileChange {
  /** Current workspace-relative path for the file. */
  path: string;
  /** Git status classification for the change. */
  change: "added" | "modified" | "deleted" | "renamed" | "untracked";
  /** Previous workspace-relative path when the file was renamed. */
  previousPath?: string;
}

/**
 * Minimal commit metadata returned by `api.git.log()`.
 */
export interface GitCommitSummary {
  sha: string;
  subject: string;
  author?: string;
  authoredAt?: string;
}

/**
 * Standard stdout/stderr process result shape used by git and exec helpers.
 */
export interface SvvyCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Metadata for an artifact written through `api.artifact.*`.
 */
export interface ArtifactWriteResult {
  artifactId: string;
  path: string;
}

/**
 * Search results returned by `api.web.search()`.
 */
export interface WebSearchResult {
  results: Array<{ title: string; url: string; snippet: string }>;
}

/**
 * Plain-text fetch result returned by `api.web.fetchText()`.
 */
export interface WebFetchTextResult {
  url: string;
  text: string;
}

/**
 * Host SDK injected as the `api` variable inside `execute_typescript`.
 *
 * Use this instead of importing Node.js built-ins such as `fs`, `path`, or
 * `process`. Paths are workspace-relative unless a method documents otherwise.
 */
export interface SvvyApi {
  /**
   * Workspace file-system helpers.
   */
  repo: {
    /**
     * Read one UTF-8 text file from the workspace.
     */
    readFile(input: { path: string }): Promise<RepoTextFile>;

    /**
     * Read several UTF-8 text files from the workspace in one call.
     */
    readFiles(input: { paths: string[] }): Promise<{ files: RepoTextFile[] }>;

    /**
     * Read and JSON-parse one workspace file.
     */
    readJson<T>(input: { path: string }): Promise<{ path: string; value: T }>;

    /**
     * Write one UTF-8 text file into the workspace.
     *
     * Set `createDirectories` when parent directories may not exist yet.
     */
    writeFile(input: {
      path: string;
      text: string;
      createDirectories?: boolean;
    }): Promise<RepoWriteResult>;

    /**
     * Serialize and write JSON into the workspace.
     *
     * `pretty` defaults to compact JSON unless explicitly enabled.
     */
    writeJson<T>(input: {
      path: string;
      value: T;
      pretty?: boolean;
      createDirectories?: boolean;
    }): Promise<RepoWriteResult>;

    /**
     * Delete one workspace file if it exists.
     */
    unlink(input: { path: string }): Promise<{ path: string; deleted: boolean }>;

    /**
     * Inspect whether a workspace path exists and what kind of entry it is.
     */
    stat(input: { path: string }): Promise<RepoStat>;

    /**
     * Expand a glob within the workspace.
     *
     * `cwd` is also workspace-relative when provided.
     */
    glob(input: {
      pattern: string;
      cwd?: string;
      includeDirectories?: boolean;
      maxResults?: number;
    }): Promise<{ paths: string[] }>;

    /**
     * Search workspace files for matching text.
     *
     * Use `regex: true` only when you really want regular-expression matching.
     */
    grep(input: {
      pattern: string;
      glob?: string;
      maxResults?: number;
      caseSensitive?: boolean;
      regex?: boolean;
    }): Promise<{ matches: RepoGrepMatch[] }>;
  };

  /**
   * Curated git helpers that keep common repository operations explicit.
   */
  git: {
    /**
     * Read the current branch, ahead/behind counts, and changed files.
     */
    status(input?: { paths?: string[] }): Promise<{
      branch?: string;
      files: GitFileChange[];
      ahead?: number;
      behind?: number;
    }>;

    /**
     * Read a unified diff.
     */
    diff(input?: {
      paths?: string[];
      cached?: boolean;
      baseRef?: string;
      headRef?: string;
    }): Promise<{ text: string }>;

    /**
     * Read recent commit summaries.
     */
    log(input?: { ref?: string; limit?: number }): Promise<{ commits: GitCommitSummary[] }>;

    /**
     * Read a commit, ref, or file from git.
     */
    show(input: { ref: string; path?: string }): Promise<{ text: string }>;

    /**
     * List local or remote branches.
     */
    branch(input?: { all?: boolean; verbose?: boolean }): Promise<{
      current?: string;
      branches: Array<{ name: string; current: boolean; upstream?: string }>;
    }>;

    /**
     * Resolve the merge base between two refs.
     */
    mergeBase(input: { baseRef: string; headRef: string }): Promise<{ sha?: string }>;

    fetch(input?: {
      remote?: string;
      refspecs?: string[];
      prune?: boolean;
    }): Promise<SvvyCommandResult>;

    pull(input?: {
      remote?: string;
      branch?: string;
      rebase?: boolean;
    }): Promise<SvvyCommandResult>;

    push(input?: {
      remote?: string;
      branch?: string;
      setUpstream?: boolean;
      forceWithLease?: boolean;
      tags?: boolean;
    }): Promise<SvvyCommandResult>;

    add(input: { paths?: string[]; all?: boolean; update?: boolean }): Promise<SvvyCommandResult>;

    commit(input: {
      message: string;
      all?: boolean;
      allowEmpty?: boolean;
      amend?: boolean;
    }): Promise<SvvyCommandResult & { sha?: string }>;

    switch(input: {
      branch: string;
      create?: boolean;
      startPoint?: string;
    }): Promise<SvvyCommandResult>;

    checkout(input: {
      ref?: string;
      paths?: string[];
      createBranch?: string;
    }): Promise<SvvyCommandResult>;

    restore(input: {
      paths: string[];
      source?: string;
      staged?: boolean;
      worktree?: boolean;
    }): Promise<SvvyCommandResult>;

    rebase(input: {
      upstream?: string;
      branch?: string;
      continue?: boolean;
      abort?: boolean;
    }): Promise<SvvyCommandResult>;

    cherryPick(input: {
      commits?: string[];
      continue?: boolean;
      abort?: boolean;
      noCommit?: boolean;
    }): Promise<SvvyCommandResult>;

    stash(input?: {
      subcommand?: "push" | "pop" | "apply" | "drop" | "list" | "show";
      stash?: string;
      message?: string;
      includeUntracked?: boolean;
    }): Promise<SvvyCommandResult>;

    tag(input?: {
      name?: string;
      target?: string;
      annotate?: boolean;
      message?: string;
      delete?: boolean;
      list?: boolean;
      pattern?: string;
    }): Promise<SvvyCommandResult>;
  };

  /**
   * Explicit subprocess execution.
   *
   * Pass the executable name in `command` and each token separately in `args`.
   * Do not join the whole shell command into one string.
   */
  exec: {
    run(input: {
      command: string;
      args?: string[];
      cwd?: string;
      timeoutMs?: number;
      env?: Record<string, string>;
    }): Promise<SvvyCommandResult>;
  };

  /**
   * Durable artifact creation helpers.
   */
  artifact: {
    /**
     * Write a UTF-8 text artifact owned by the current command.
     */
    writeText(input: { name: string; text: string }): Promise<ArtifactWriteResult>;

    /**
     * Serialize JSON into an artifact owned by the current command.
     */
    writeJson<T>(input: { name: string; value: T; pretty?: boolean }): Promise<ArtifactWriteResult>;

    /**
     * Attach an existing workspace file as an artifact.
     */
    attachFile(input: { path: string; name?: string }): Promise<ArtifactWriteResult>;
  };

  /**
   * Bounded web helpers for generic lookups.
   */
  web: {
    /**
     * Run a small web search and return extracted result snippets.
     */
    search(input: { query: string; maxResults?: number }): Promise<WebSearchResult>;

    /**
     * Fetch one URL as plain text.
     */
    fetchText(input: { url: string }): Promise<WebFetchTextResult>;
  };
}
