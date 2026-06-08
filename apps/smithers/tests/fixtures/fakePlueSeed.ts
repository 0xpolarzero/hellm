/**
 * Deterministic seed data for the fake Plue/jjhub REST API used in e2e tests
 * and worker proxy tests. Pure — no I/O, no globals. Importable from both Bun
 * test files and the Bun server fixture so a single seed defines what the UI
 * sees.
 *
 * The shapes mirror the Plue Go responses the new UI consumes (snake_case
 * fields, integer ids, `Link: rel="next"` pagination on lists). When Plue
 * changes a shape, change it here and the test gauntlet catches the UI drift.
 */

export type PlueUser = {
  id: number;
  username: string;
  display_name: string;
  email: string;
  avatar_url: string;
  is_admin: boolean;
};

export type PlueRepo = {
  id: number;
  full_name: string;
  description: string;
  default_branch: string;
  private: boolean;
  open_issues_count: number;
  updated_at: string;
};

export type PlueIssue = {
  id: number;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  comments: number;
  updated_at: string;
};

export type PlueLanding = {
  id: number;
  number: number;
  title: string;
  state: "open" | "merged" | "closed";
  branch: string;
  base: string;
  updated_at: string;
  agent: string;
};

export type PlueWorkspace = {
  id: string;
  name: string;
  repo: string;
  branch: string;
  agent: string;
  status: "idle" | "running" | "ready";
  updated_at: string;
};

export type PlueNotification = {
  id: string;
  kind: "issue" | "landing" | "approval" | "workspace";
  title: string;
  url: string;
  read: boolean;
  updated_at: string;
};

export const SEED_USER: PlueUser = {
  id: 7,
  username: "will",
  display_name: "Will Cory",
  email: "will@smithers.dev",
  avatar_url: "https://avatars.smithers.dev/will.png",
  is_admin: true,
};

export const SEED_ADMIN_TOKEN = "smithers_e2e_admin_token";
export const SEED_USER_TOKEN = "smithers_e2e_user_token";
export const SEED_SESSION_COOKIE = "smithers_session=ok";

export const SEED_REPOS: readonly PlueRepo[] = Object.freeze([
  {
    id: 100,
    full_name: "smithers/apps-smithers",
    description: "The new PWA shell for Smithers",
    default_branch: "main",
    private: false,
    open_issues_count: 5,
    updated_at: "2026-06-01T12:00:00Z",
  },
  {
    id: 101,
    full_name: "smithers/cli",
    description: "Smithers CLI, gateway, packs",
    default_branch: "main",
    private: false,
    open_issues_count: 12,
    updated_at: "2026-06-02T08:30:00Z",
  },
  {
    id: 102,
    full_name: "acme/widgets",
    description: "Widget service for the demo org",
    default_branch: "trunk",
    private: true,
    open_issues_count: 2,
    updated_at: "2026-05-29T17:45:00Z",
  },
]);

/** Build a large, stable issue list per repo so pagination + virtualization
 *  are exercised. Issue numbers descend so the newest sits at the head. */
export function buildIssues(repo: string, count: number): PlueIssue[] {
  const seedTitles = [
    "Composer focus glow flickers on theme toggle",
    "Issues list overflows on narrow PWA layout",
    "Gateway run inspector drops live node status",
    "VCS card should show ahead/behind on the current bookmark",
    "Dark theme tone tokens wash out on the approval gate",
    "Document the feature-card + canvas-route pattern",
    "Crons card seed data uses a stale timezone string",
    "Add a diff canvas for the review surface",
    "Notification toaster should respect prefers-reduced-motion",
    "Approval gate hover state has the wrong cursor token",
  ];
  const issues: PlueIssue[] = [];
  for (let n = count; n >= 1; n -= 1) {
    const offset = count - n;
    const title = seedTitles[offset % seedTitles.length];
    const state: "open" | "closed" = offset < count - 30 ? "closed" : "open";
    issues.push({
      id: 10_000 + n,
      number: n,
      title: `${title} (#${n})`,
      body: `Repro: open the surface against ${repo} and watch the seeded data flow.`,
      state,
      labels: offset % 4 === 0 ? ["bug", "ui"] : offset % 3 === 0 ? ["feat"] : ["docs"],
      assignees: offset % 5 === 0 ? ["will", "ada"] : offset % 2 === 0 ? ["will"] : [],
      comments: offset % 7,
      updated_at: `2026-05-${String(((offset % 28) + 1)).padStart(2, "0")}T09:00:00Z`,
    });
  }
  return issues;
}

export function buildLandings(repo: string, count: number): PlueLanding[] {
  const landings: PlueLanding[] = [];
  const states: Array<PlueLanding["state"]> = ["open", "merged", "closed"];
  for (let n = count; n >= 1; n -= 1) {
    const offset = count - n;
    landings.push({
      id: 20_000 + n,
      number: n,
      title: `Land seeded change #${n} on ${repo}`,
      state: states[offset % states.length],
      branch: `landing/${repo.split("/")[1] ?? "main"}-${n}`,
      base: "main",
      updated_at: `2026-05-${String(((offset % 28) + 1)).padStart(2, "0")}T10:00:00Z`,
      agent: offset % 2 === 0 ? "ralph" : "claude-opus-4-7",
    });
  }
  return landings;
}

export function buildWorkspaces(repo: string): PlueWorkspace[] {
  return [
    {
      id: `${repo.replace("/", "-")}-ws-1`,
      name: "ralph-1",
      repo,
      branch: "ralph/loop-1",
      agent: "ralph",
      status: "running",
      updated_at: "2026-06-04T18:01:00Z",
    },
    {
      id: `${repo.replace("/", "-")}-ws-2`,
      name: "claude-debug",
      repo,
      branch: "debug/cron-tz",
      agent: "claude-opus-4-7",
      status: "ready",
      updated_at: "2026-06-04T19:30:00Z",
    },
    {
      id: `${repo.replace("/", "-")}-ws-3`,
      name: "idle-pool",
      repo,
      branch: repo === "smithers/cli" ? "main" : "trunk",
      agent: "codex",
      status: "idle",
      updated_at: "2026-06-03T22:00:00Z",
    },
  ];
}

export function buildNotifications(): PlueNotification[] {
  return [
    {
      id: "ntf-1",
      kind: "issue",
      title: "will mentioned you on smithers/apps-smithers#42",
      url: "/smithers/apps-smithers/issues/42",
      read: false,
      updated_at: "2026-06-04T21:00:00Z",
    },
    {
      id: "ntf-2",
      kind: "landing",
      title: "Landing #18 on smithers/cli is ready for review",
      url: "/smithers/cli/landings/18",
      read: false,
      updated_at: "2026-06-04T19:00:00Z",
    },
    {
      id: "ntf-3",
      kind: "approval",
      title: "Approval gate pending on run demo-ui-run-1",
      url: "/runs/demo-ui-run-1",
      read: true,
      updated_at: "2026-06-03T15:45:00Z",
    },
    {
      id: "ntf-4",
      kind: "workspace",
      title: "ralph-1 workspace is now running",
      url: "/smithers/apps-smithers/workspaces/ralph-1",
      read: true,
      updated_at: "2026-06-03T08:10:00Z",
    },
  ];
}

/** Total issues per repo when the harness boots; large enough to force at
 *  least three pages at the default 100-per-page limit. */
export const DEFAULT_ISSUES_PER_REPO = 250;
export const DEFAULT_LANDINGS_PER_REPO = 60;
export const DEFAULT_PAGE_SIZE = 100;
