export const mockWorkspace = {
  path: "~/code/auth-service",
  branch: "feat/oauth-provider",
  displayName: "auth-service",
};

export type SessionStatus = "running" | "done" | "waiting" | "failed" | "idle";
export type AgentType =
  | "orchestrator"
  | "quick"
  | "explorer"
  | "implementer"
  | "reviewer"
  | "workflow-writer";
export type NodeType =
  | "agent-task"
  | "script"
  | "verification"
  | "wait"
  | "retry"
  | "terminal"
  | "preflight"
  | "validation";
export type NodeStatus = "completed" | "active" | "waiting" | "failed";
export type ArtifactType = "diff" | "log" | "screenshot" | "report" | "html" | "json";

export interface Session {
  id: string;
  title: string;
  preview: string;
  status: SessionStatus;
  time: string;
  model: string;
  activeAgents?: number;
  budgetPercent?: number;
  pane?: string;
  branch?: string;
  folder?: string;
  mode?: "orchestrator" | "quick";
  currentExecutor?: string;
  waitingReason?: string;
  worktree?: string;
  runtimeProfileOverride?: boolean;
}

export interface Thread {
  id: string;
  title: string;
  status: SessionStatus;
  progress: number;
  objective: string;
  worktree: string;
  elapsed: string;
  model: string;
  changedFiles?: string[];
  conclusions?: string[];
  unresolvedIssues?: string[];
  followUpSuggestions?: string[];
  executor?: string;
  blockedReason?: string;
  verificationSummary?: string;
}

export interface SubagentItem {
  id: string;
  type: AgentType;
  headline: string;
  status: SessionStatus;
  progress?: number;
  model: string;
  elapsed: string;
  tokens?: number;
}

export interface WorkflowRun {
  id: string;
  name: string;
  runId: string;
  stepsTotal: number;
  stepsDone: number;
  currentStep: string;
  status: SessionStatus;
  elapsed: string;
  runtimeProfile: string;
  worktree: string;
  lastUpdated?: string;
}

export interface Episode {
  id: string;
  title: string;
  summary: string;
  artifacts: ArtifactItem[];
  verified: boolean;
  thread: string;
  model: string;
  worktree: string;
}

export interface ArtifactItem {
  id: string;
  name: string;
  type: ArtifactType;
  size: string;
  age: string;
  session: string;
  thread?: string;
}

export interface VerificationResult {
  id: string;
  passed: boolean;
  build: "pass" | "fail" | "skip";
  tests: "pass" | "fail" | "skip";
  lint: "pass" | "fail" | "skip";
  testsTotal: number;
  testsPassed: number;
  summary: string;
  errorSnippet?: string;
  artifacts?: ArtifactItem[];
}

export interface RuntimeProfile {
  role: string;
  model: string;
  reasoning: string;
  maxTokens: number;
  temperature: number;
  budgetPerStep: string;
  provider: string;
}

export interface PaneSurface {
  id: string;
  label: string;
  positions: string[];
  type: "session" | "workflow" | "subagent" | "artifact";
}

export interface FolderGroup {
  label: string;
  sessionIds: string[];
}

export interface MentionTarget {
  path: string;
  isFolder: boolean;
  resolvedPath: string;
}

export interface WorkflowNode {
  id: string;
  label: string;
  type: NodeType;
  status: NodeStatus;
  x: number;
  y: number;
  objective?: string;
  latestOutput?: string;
  model?: string;
  elapsed?: string;
  worktree?: string;
  artifacts?: ArtifactItem[];
}

export interface WorkflowEdge {
  from: string;
  to: string;
}

export const mockSessions: Session[] = [
  {
    id: "s1",
    title: "OAuth Provider Integration",
    preview: "Implementing Google and GitHub OAuth with PKCE flow...",
    status: "running",
    time: "2m ago",
    model: "opus",
    activeAgents: 3,
    budgetPercent: 71,
    pane: "[1,1]",
    branch: "feat/oauth-provider",
    folder: "Current focus",
    mode: "orchestrator",
    currentExecutor: "Orchestrator",
    worktree: "feat/oauth-provider",
  },
  {
    id: "s2",
    title: "Fix rate limiting bug",
    preview: "Verified fix for redis token bucket logic",
    status: "done",
    time: "1h ago",
    model: "sonnet",
    branch: "fix/rate-limit",
    folder: "Recent wins",
    mode: "quick",
    currentExecutor: "Verification",
    worktree: "fix/rate-limit",
  },
  {
    id: "s3",
    title: "Refactor middleware layer",
    preview: "Waiting for clarification on auth header format",
    status: "waiting",
    time: "3h ago",
    model: "opus",
    branch: "feat/oauth-provider",
    folder: "Current focus",
    mode: "orchestrator",
    currentExecutor: "Clarification",
    waitingReason: "Need token refresh behavior decision",
    worktree: "feat/oauth-provider",
  },
  {
    id: "s4",
    title: "Update CI pipeline",
    preview: "Tests failed on Node 18 compatibility job",
    status: "failed",
    time: "1d ago",
    model: "sonnet",
    branch: "ci/node18",
    folder: "CI hardening",
    mode: "orchestrator",
    currentExecutor: "Verification",
    worktree: "ci/node18",
  },
  {
    id: "s5",
    title: "Add request logging",
    preview: "Idle — started new session",
    status: "idle",
    time: "2d ago",
    model: "haiku",
    branch: "feat/logging",
    folder: "Backlog",
    mode: "quick",
    currentExecutor: "Idle",
    worktree: "feat/logging",
  },
  {
    id: "s6",
    title: "Structured state projection",
    preview: "Rebuilding threads and episodes from durable state overlays",
    status: "running",
    time: "6m ago",
    model: "opus",
    activeAgents: 2,
    budgetPercent: 56,
    pane: "[1,2]",
    branch: "feat/session-overlay",
    folder: "Current focus",
    mode: "orchestrator",
    currentExecutor: "Workflow writer",
    worktree: "feat/session-overlay",
  },
];

export const mockThreads: Thread[] = [
  {
    id: "t1",
    title: "Implement auth middleware",
    status: "done",
    progress: 100,
    objective: "Create OAuth middleware supporting GitHub and Google providers with PKCE flow",
    worktree: "feat/oauth-provider",
    elapsed: "3m 42s",
    model: "sonnet",
    changedFiles: [
      "src/middleware/auth.ts",
      "src/utils/oauth.ts",
      "src/types/oauth.ts",
      "tests/middleware/auth.test.ts",
    ],
    conclusions: [
      "OAuth middleware implemented with PKCE support",
      "GitHub and Google providers both working",
      "Unit tests passing (12/12)",
    ],
    unresolvedIssues: [],
    followUpSuggestions: [
      "Add token refresh logic for long-lived sessions",
      "Consider adding rate limiting per provider",
    ],
    executor: "Implementer",
    verificationSummary: "Unit tests passing (12/12)",
  },
  {
    id: "t2",
    title: "Write integration tests",
    status: "running",
    progress: 45,
    objective: "Write comprehensive integration tests for the OAuth flow including edge cases",
    worktree: "feat/oauth-provider",
    elapsed: "1m 12s",
    model: "sonnet",
    changedFiles: ["tests/integration/oauth.test.ts", "tests/fixtures/oauth.ts"],
    conclusions: [],
    unresolvedIssues: ["Token expiry handling not yet covered"],
    followUpSuggestions: [],
    executor: "Implementer",
    blockedReason: "Need refresh-token decision before final assertions",
    verificationSummary: "Integration suite still running",
  },
  {
    id: "t3",
    title: "Project workflow state into session timeline",
    status: "waiting",
    progress: 78,
    objective:
      "Show workflow progress, wait states, and node provenance inline in the session surface.",
    worktree: "feat/session-overlay",
    elapsed: "2m 48s",
    model: "opus",
    changedFiles: [
      "src/session/overlay.ts",
      "src/session/projection.ts",
      "src/ui/workflow-timeline.tsx",
    ],
    conclusions: ["Overlay shape validated against direct, delegated, and waiting paths"],
    unresolvedIssues: ["Need durable waiting-state wording from product"],
    followUpSuggestions: ["Surface retry provenance on the workflow card"],
    executor: "Workflow writer",
    blockedReason: "Awaiting wording for clarification pause state",
    verificationSummary: "Projection unit tests not started",
  },
];

export const mockSubagents: SubagentItem[] = [
  {
    id: "a1",
    type: "implementer",
    headline: "Writing OAuth token refresh logic in src/utils/oauth.ts",
    status: "done",
    progress: 100,
    model: "sonnet",
    elapsed: "1m 58s",
    tokens: 4210,
  },
  {
    id: "a2",
    type: "reviewer",
    headline: "Reviewing auth middleware for security vulnerabilities...",
    status: "running",
    progress: 60,
    model: "sonnet",
    elapsed: "0m 34s",
    tokens: 1840,
  },
  {
    id: "a3",
    type: "explorer",
    headline: "Explored existing auth patterns in codebase",
    status: "done",
    progress: 100,
    model: "haiku",
    elapsed: "0m 22s",
    tokens: 890,
  },
];

export const mockWorkflowRun: WorkflowRun = {
  id: "wf1",
  name: "auth-refactor-ci",
  runId: "run_j4k2m9",
  stepsTotal: 8,
  stepsDone: 3,
  currentStep: "run-tests",
  status: "running",
  elapsed: "2m 04s",
  runtimeProfile: "workflow-writer",
  worktree: "feat/oauth-provider",
  lastUpdated: "14s ago",
};

export const mockEpisodes: Episode[] = [
  {
    id: "e1",
    title: "Auth middleware implementation complete",
    summary:
      "Successfully implemented OAuth 2.0 middleware with PKCE support for GitHub and Google. All unit tests passing. Security review passed.",
    artifacts: [
      {
        id: "af1",
        name: "auth-middleware.patch",
        type: "diff",
        size: "4.2 KB",
        age: "5m ago",
        session: "OAuth Provider Integration",
        thread: "t1",
      },
      {
        id: "af2",
        name: "test-results.log",
        type: "log",
        size: "12.8 KB",
        age: "5m ago",
        session: "OAuth Provider Integration",
        thread: "t1",
      },
      {
        id: "af3",
        name: "coverage-report.html",
        type: "html",
        size: "88.4 KB",
        age: "5m ago",
        session: "OAuth Provider Integration",
        thread: "t1",
      },
    ],
    verified: true,
    thread: "Implement auth middleware",
    model: "sonnet",
    worktree: "feat/oauth-provider",
  },
];

export const mockVerification: VerificationResult = {
  id: "v1",
  passed: true,
  build: "pass",
  tests: "pass",
  lint: "pass",
  testsTotal: 24,
  testsPassed: 24,
  summary: "All 24 tests passing. Build clean. No lint violations.",
  artifacts: [
    {
      id: "af2",
      name: "test-results.log",
      type: "log",
      size: "12.8 KB",
      age: "5m ago",
      session: "OAuth Provider Integration",
      thread: "t1",
    },
    {
      id: "af3",
      name: "coverage-report.html",
      type: "html",
      size: "88.4 KB",
      age: "5m ago",
      session: "OAuth Provider Integration",
      thread: "t1",
    },
  ],
};

export const mockVerificationFailed: VerificationResult = {
  id: "v2",
  passed: false,
  build: "pass",
  tests: "fail",
  lint: "fail",
  testsTotal: 16,
  testsPassed: 12,
  summary: "4 tests failed. 2 lint violations in src/middleware/auth.ts.",
  errorSnippet: `FAIL tests/middleware/auth.test.ts
  ● AuthMiddleware › should reject expired tokens

    expect(received).toBe(expected)

    Expected: 401
    Received: 200

      42 |   it('should reject expired tokens', async () => {
    > 43 |     expect(response.status).toBe(401);
         |                             ^
      44 |   });`,
  artifacts: [
    {
      id: "af7",
      name: "ci-run.log",
      type: "log",
      size: "44.2 KB",
      age: "1d ago",
      session: "Update CI pipeline",
    },
  ],
};

export const mockWorkflowNodes: WorkflowNode[] = [
  {
    id: "n1",
    label: "preflight-check",
    type: "preflight",
    status: "completed",
    x: 280,
    y: 20,
    objective: "Verify repository state and check for conflicts",
    latestOutput: "Repository clean. No uncommitted changes. Branch up to date.",
    elapsed: "0m 04s",
    worktree: "feat/oauth-provider",
  },
  {
    id: "n2",
    label: "fetch-context",
    type: "agent-task",
    status: "completed",
    x: 280,
    y: 120,
    objective: "Gather relevant context from codebase for the auth refactor",
    latestOutput: "Fetched 14 relevant files. Identified 3 patterns to preserve.",
    model: "haiku",
    elapsed: "0m 22s",
    worktree: "feat/oauth-provider",
  },
  {
    id: "n3",
    label: "implement-changes",
    type: "agent-task",
    status: "completed",
    x: 280,
    y: 220,
    objective: "Implement OAuth middleware changes per spec",
    latestOutput: "Applied changes to 4 files. 142 lines added, 38 lines removed.",
    model: "sonnet",
    elapsed: "1m 58s",
    worktree: "feat/oauth-provider",
  },
  {
    id: "n4",
    label: "run-tests",
    type: "verification",
    status: "active",
    x: 120,
    y: 340,
    objective: "Run full test suite and capture results",
    latestOutput: "Running... 18/24 tests complete. 0 failures so far.",
    elapsed: "0m 41s",
    worktree: "feat/oauth-provider",
  },
  {
    id: "n5",
    label: "lint-check",
    type: "script",
    status: "waiting",
    x: 440,
    y: 340,
    objective: "Run ESLint and TypeScript strict checks",
    worktree: "feat/oauth-provider",
  },
  {
    id: "n6",
    label: "review-changes",
    type: "agent-task",
    status: "waiting",
    x: 280,
    y: 460,
    objective: "Security and code quality review of implemented changes",
    model: "sonnet",
    worktree: "feat/oauth-provider",
  },
  {
    id: "n7",
    label: "apply-diff",
    type: "script",
    status: "waiting",
    x: 280,
    y: 560,
    objective: "Apply the verified diff to the working tree",
    worktree: "feat/oauth-provider",
  },
  {
    id: "n8",
    label: "final-validation",
    type: "validation",
    status: "waiting",
    x: 280,
    y: 660,
    objective: "Run final integration smoke tests and confirm deployment readiness",
    worktree: "feat/oauth-provider",
  },
];

export const mockWorkflowEdges: WorkflowEdge[] = [
  { from: "n1", to: "n2" },
  { from: "n2", to: "n3" },
  { from: "n3", to: "n4" },
  { from: "n3", to: "n5" },
  { from: "n4", to: "n6" },
  { from: "n5", to: "n6" },
  { from: "n6", to: "n7" },
  { from: "n7", to: "n8" },
];

export const mockArtifacts: ArtifactItem[] = [
  {
    id: "af1",
    name: "auth-middleware.patch",
    type: "diff",
    size: "4.2 KB",
    age: "5m ago",
    session: "OAuth Provider Integration",
    thread: "t1",
  },
  {
    id: "af2",
    name: "test-results.log",
    type: "log",
    size: "12.8 KB",
    age: "5m ago",
    session: "OAuth Provider Integration",
    thread: "t1",
  },
  {
    id: "af3",
    name: "coverage-report.html",
    type: "html",
    size: "88.4 KB",
    age: "5m ago",
    session: "OAuth Provider Integration",
    thread: "t1",
  },
  {
    id: "af4",
    name: "middleware-screenshot.png",
    type: "screenshot",
    size: "224 KB",
    age: "12m ago",
    session: "OAuth Provider Integration",
  },
  {
    id: "af5",
    name: "lint-report.json",
    type: "json",
    size: "3.1 KB",
    age: "1h ago",
    session: "Fix rate limiting bug",
    thread: "t2",
  },
  {
    id: "af6",
    name: "rate-limit-fix.patch",
    type: "diff",
    size: "1.8 KB",
    age: "1h ago",
    session: "Fix rate limiting bug",
  },
  {
    id: "af7",
    name: "ci-run.log",
    type: "log",
    size: "44.2 KB",
    age: "1d ago",
    session: "Update CI pipeline",
  },
  {
    id: "af8",
    name: "test-report.html",
    type: "html",
    size: "102.6 KB",
    age: "1d ago",
    session: "Update CI pipeline",
  },
];

export const mockRuntimeProfiles: RuntimeProfile[] = [
  {
    role: "Orchestrator",
    model: "claude-opus-4.5",
    reasoning: "extended",
    maxTokens: 32000,
    temperature: 0.3,
    budgetPerStep: "$0.08",
    provider: "Anthropic",
  },
  {
    role: "Quick",
    model: "claude-haiku-3.5",
    reasoning: "none",
    maxTokens: 8000,
    temperature: 0.5,
    budgetPerStep: "$0.002",
    provider: "Anthropic",
  },
  {
    role: "Explorer",
    model: "claude-sonnet-4.5",
    reasoning: "brief",
    maxTokens: 16000,
    temperature: 0.4,
    budgetPerStep: "$0.018",
    provider: "Anthropic",
  },
  {
    role: "Implementer",
    model: "claude-sonnet-4.5",
    reasoning: "standard",
    maxTokens: 24000,
    temperature: 0.2,
    budgetPerStep: "$0.024",
    provider: "Anthropic",
  },
  {
    role: "Reviewer",
    model: "claude-sonnet-4.5",
    reasoning: "standard",
    maxTokens: 16000,
    temperature: 0.3,
    budgetPerStep: "$0.018",
    provider: "Anthropic",
  },
  {
    role: "Workflow-writer",
    model: "claude-sonnet-4.5",
    reasoning: "brief",
    maxTokens: 16000,
    temperature: 0.3,
    budgetPerStep: "$0.018",
    provider: "Anthropic",
  },
  {
    role: "Namer",
    model: "gpt-5.4-mini",
    reasoning: "low",
    maxTokens: 4000,
    temperature: 0.2,
    budgetPerStep: "$0.001",
    provider: "OpenAI",
  },
];

export const mockFolderGroups: FolderGroup[] = [
  { label: "Current focus", sessionIds: ["s1", "s3", "s6"] },
  { label: "Recent wins", sessionIds: ["s2"] },
  { label: "CI hardening", sessionIds: ["s4"] },
  { label: "Backlog", sessionIds: ["s5"] },
];

export const mockPaneSurfaces: PaneSurface[] = [
  {
    id: "surface-session-main",
    label: "OAuth Provider Integration",
    positions: ["[1,1]", "[2,1]"],
    type: "session",
  },
  {
    id: "surface-workflow-auth",
    label: "auth-refactor-ci",
    positions: ["[1,3]"],
    type: "workflow",
  },
  { id: "surface-subagent-explorer", label: "explorer", positions: ["[2,2]"], type: "subagent" },
  { id: "surface-artifacts", label: "Artifacts", positions: ["[2,3]"], type: "artifact" },
];

export const mockMentionTargets: MentionTarget[] = [
  {
    path: "src/middleware/auth.ts",
    isFolder: false,
    resolvedPath: "/workspace/src/middleware/auth.ts",
  },
  { path: "tests/", isFolder: true, resolvedPath: "/workspace/tests" },
  { path: ".svvy/hooks/", isFolder: true, resolvedPath: "/workspace/.svvy/hooks" },
];
