/**
 * The landings surface: stacked PRs / changes ready to merge (jjhub). Each
 * landing carries a number, a target bookmark, a review status, and seeded
 * diff + checks text so the detail tabs always have content. Ported from the
 * Swift LandingsView; seeded/mock like the other feature cards since apps/smithers
 * has no gateway. The real landings live behind the jjhub workflow.
 *
 * Everything below the seed data is pure, so the filters, reducers, and the
 * diff parser are unit-tested without a DOM (see landingsDomain.test.ts).
 */
export type LandingState = "open" | "draft" | "merged" | "closed";

export type ReviewStatus = "approved" | "changes_requested" | "pending";

export type LandingFilter = LandingState | "all";

export type DetailTab = "info" | "diff" | "checks";

export type ReviewAction = "approve" | "request_changes" | "comment";

/** One stacked change. diff is unified-diff text, checks is plaintext CI output. */
export type Landing = {
  id: string;
  number: number;
  title: string;
  description: string;
  state: LandingState;
  targetBranch: string;
  author: string;
  createdAt: string;
  reviewStatus: ReviewStatus;
  diff: string;
  checks: string;
};

export const SEEDED_LANDINGS: Landing[] = [
  {
    id: "landing-128",
    number: 128,
    title: "feat(landings): stacked PR dashboard",
    description:
      "Adds the landings card and canvas so a stack of changes is reviewable and landable from one place.",
    state: "open",
    targetBranch: "main",
    author: "will",
    createdAt: "2026-06-05",
    reviewStatus: "pending",
    diff: [
      "diff --git a/apps/smithers/src/landings/LandingsCanvas.tsx b/apps/smithers/src/landings/LandingsCanvas.tsx",
      "@@ -0,0 +1,4 @@",
      "+export function LandingsCanvas() {",
      "+  const landings = useLandingsStore((s) => s.landings);",
      "+  return <section className=\"surface\" />;",
      "+}",
    ].join("\n"),
    checks: ["typecheck   pass", "bun test    pass (42)", "lint        pass"].join("\n"),
  },
  {
    id: "landing-127",
    number: 127,
    title: "feat(gateway): per-run inspector store",
    description: "Splits the run inspector into a per-run store so detached runs keep their own tab state.",
    state: "open",
    targetBranch: "main",
    author: "ada",
    createdAt: "2026-06-04",
    reviewStatus: "approved",
    diff: [
      "diff --git a/apps/smithers/src/runs/NodeInspector.tsx b/apps/smithers/src/runs/NodeInspector.tsx",
      "@@ -12,7 +12,7 @@ export function NodeInspector() {",
      "-  const tab = useRunStore((s) => s.tab);",
      "+  const tab = useInspectorStore((s) => s.tab);",
      "   return <div className=\"inspect-pane\" />;",
    ].join("\n"),
    checks: ["typecheck   pass", "bun test    pass (39)", "lint        pass"].join("\n"),
  },
  {
    id: "landing-126",
    number: 126,
    title: "fix(vcs): stage untracked files",
    description: "Untracked files could not be staged from the canvas. The toggle now stages them too.",
    state: "draft",
    targetBranch: "main",
    author: "grace",
    createdAt: "2026-06-03",
    reviewStatus: "changes_requested",
    diff: [
      "diff --git a/apps/smithers/src/vcs/vcs.ts b/apps/smithers/src/vcs/vcs.ts",
      "@@ -88,7 +88,7 @@ export function toggleStaged(tree, path) {",
      "-      change.path === path ? change : change,",
      "+      change.path === path ? { ...change, staged: !change.staged } : change,",
    ].join("\n"),
    checks: ["typecheck   pass", "bun test    fail (1)", "lint        pass"].join("\n"),
  },
  {
    id: "landing-125",
    number: 125,
    title: "feat(crons): pause and resume schedules",
    description: "Adds a pause toggle to the crons card so a schedule can be held without deleting it.",
    state: "merged",
    targetBranch: "main",
    author: "linus",
    createdAt: "2026-06-02",
    reviewStatus: "approved",
    diff: [
      "diff --git a/apps/smithers/src/crons/CronsCard.tsx b/apps/smithers/src/crons/CronsCard.tsx",
      "@@ -30,6 +30,9 @@ export function CronsCard() {",
      "+        <button type=\"button\" onClick={() => toggle(cron.id)}>",
      "+          {cron.enabled ? \"Pause\" : \"Resume\"}",
      "+        </button>",
    ].join("\n"),
    checks: ["typecheck   pass", "bun test    pass (37)", "lint        pass"].join("\n"),
  },
  {
    id: "landing-124",
    number: 124,
    title: "chore(docs): rewrite the onboarding guide",
    description: "Replaces the stale onboarding doc with a Kernighan-style walkthrough of the first run.",
    state: "closed",
    targetBranch: "main",
    author: "ada",
    createdAt: "2026-05-30",
    reviewStatus: "pending",
    diff: [
      "diff --git a/docs/onboarding.md b/docs/onboarding.md",
      "@@ -1,3 +1,3 @@",
      "-# Getting started (draft)",
      "+# Getting started",
      " Run `smithers up` to start your first workflow.",
    ].join("\n"),
    checks: ["typecheck   pass", "lint        pass"].join("\n"),
  },
];

/** Keep landings whose state matches the filter; "all" keeps everything. Immutable. */
export function filterLandings(landings: Landing[], filter: LandingFilter): Landing[] {
  if (filter === "all") return landings.slice();
  return landings.filter((landing) => landing.state === filter);
}

/** Headline counts for the card subtitle and canvas header. */
export function summarizeLandings(landings: Landing[]): { total: number; open: number; merged: number } {
  let open = 0;
  let merged = 0;
  for (const landing of landings) {
    if (landing.state === "open") open += 1;
    else if (landing.state === "merged") merged += 1;
  }
  return { total: landings.length, open, merged };
}

/** Tone class for a landing's state dot / badge. */
export function toneForLandingState(state: LandingState): string {
  switch (state) {
    case "open":
      return "tone-info";
    case "draft":
      return "tone-running";
    case "merged":
      return "tone-ok";
    case "closed":
      return "tone-idle";
  }
}

/** Tone class for a review status. */
export function toneForReviewStatus(status: ReviewStatus): string {
  switch (status) {
    case "approved":
      return "tone-ok";
    case "changes_requested":
      return "tone-failed";
    case "pending":
      return "tone-idle";
  }
}

/** Only open landings can be landed. */
export function canLand(landing: Landing): boolean {
  return landing.state === "open";
}

/** Merged and closed landings are terminal: no review or land actions. */
export function isTerminal(state: LandingState): boolean {
  return state === "merged" || state === "closed";
}

/**
 * Apply a review to one landing by number. approve sets reviewStatus "approved",
 * request_changes sets "changes_requested", comment leaves it unchanged. Immutable.
 */
export function reviewLanding(landings: Landing[], number: number, action: ReviewAction): Landing[] {
  if (action === "comment") return landings.slice();
  const reviewStatus: ReviewStatus = action === "approve" ? "approved" : "changes_requested";
  return landings.map((landing) =>
    landing.number === number ? { ...landing, reviewStatus } : landing,
  );
}

/** Mark one landing merged by number. Immutable. */
export function landLanding(landings: Landing[], number: number): Landing[] {
  return landings.map((landing) =>
    landing.number === number ? { ...landing, state: "merged" } : landing,
  );
}

/** Next landing number: one past the current max, so ids stay stable without time. */
export function nextLandingNumber(landings: Landing[]): number {
  let max = 0;
  for (const landing of landings) {
    if (landing.number > max) max = landing.number;
  }
  return max + 1;
}

/**
 * Create a landing from a draft, prepended to the list. New landings are open
 * and pending with an empty diff and checks; the target falls back to "main".
 * Immutable.
 */
export function createLanding(
  landings: Landing[],
  draft: { title: string; description: string; target: string },
): { landings: Landing[]; created: Landing } {
  const number = nextLandingNumber(landings);
  const created: Landing = {
    id: `landing-${number}`,
    number,
    title: draft.title,
    description: draft.description,
    state: "open",
    targetBranch: draft.target || "main",
    author: "will",
    createdAt: "just now",
    reviewStatus: "pending",
    diff: "",
    checks: "",
  };
  return { landings: [created, ...landings], created };
}

/**
 * Split a unified diff into signed lines: a "+" that is not "+++" is an add,
 * a "-" that is not "---" is a del, everything else (file and @@ headers
 * included) is context. Nothing is dropped.
 */
export function parseDiffLines(diff: string): { sign: " " | "+" | "-"; text: string }[] {
  return diff.split("\n").map((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      return { sign: "+" as const, text: line.slice(1) };
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      return { sign: "-" as const, text: line.slice(1) };
    }
    return { sign: " " as const, text: line };
  });
}
