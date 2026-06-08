/**
 * The issues surface: a tracker list with open/closed state, labels, assignees,
 * and comment counts, ported from the Swift IssuesView (JJHub issues). One card
 * and one canvas render the same seeded list; the three-segment open/closed/all
 * filter mirrors the gui. Seeded with a believable demo backlog like the other
 * feature cards (apps/smithers has no gateway yet).
 *
 * Everything below the seed data is pure, so the filters, summary, and the
 * create/close/reopen reducers are unit-tested without a DOM (see
 * issuesDomain.test.ts).
 */
export type IssueState = "open" | "closed";

export type IssueFilter = IssueState | "all";

/** One tracker issue: number, title, markdown body, state, and its metadata. */
export type Issue = {
  id: string;
  number: number;
  title: string;
  body: string;
  state: IssueState;
  labels: string[];
  assignees: string[];
  commentCount: number;
};

export const SEEDED_ISSUES: Issue[] = [
  {
    id: "issue-42",
    number: 42,
    title: "Issues card overflows on narrow PWA layout",
    body:
      "On a 360px column the `.list-tags` comment count wraps under the labels.\n\nClamp the row and ellipsize the title so the meta line stays single-row.",
    state: "open",
    labels: ["bug", "ui"],
    assignees: ["will"],
    commentCount: 3,
  },
  {
    id: "issue-41",
    number: 41,
    title: "Gateway run inspector drops live node status",
    body:
      "Switching from the workflow UI back to the inspector loses the running tone on in-flight nodes.\n\nRebind `gatewayInspectorStore` on tab focus.",
    state: "open",
    labels: ["bug", "gateway"],
    assignees: ["will", "ada"],
    commentCount: 5,
  },
  {
    id: "issue-40",
    number: 40,
    title: "VCS card should show ahead/behind on the current bookmark",
    body:
      "The Changes card lists files but hides how far the branch sits from trunk.\n\nSurface `ahead`/`behind` from the current bookmark as mini-tags.",
    state: "open",
    labels: ["feat", "ui"],
    assignees: ["ada"],
    commentCount: 1,
  },
  {
    id: "issue-39",
    number: 39,
    title: "Dark theme tone tokens wash out on the approval gate",
    body:
      "`--st-waiting` at 11% mix is hard to read on the pending approval card in dark mode.\n\nBump the surface mix or the border alpha.",
    state: "open",
    labels: ["ui", "theming"],
    assignees: [],
    commentCount: 0,
  },
  {
    id: "issue-38",
    number: 38,
    title: "Document the feature-card + canvas-route pattern",
    body:
      "New contributors keep reinventing the card/store/canvas split.\n\nWrite a short guide that points at the vcs feature as the canonical template.",
    state: "open",
    labels: ["docs"],
    assignees: ["will"],
    commentCount: 2,
  },
  {
    id: "issue-37",
    number: 37,
    title: "Composer focus glow flickers on theme toggle",
    body:
      "Toggling light/dark re-runs the brand glow transition once.\n\nGate the transition on a class the toggle does not touch.",
    state: "closed",
    labels: ["bug", "ui"],
    assignees: ["ada"],
    commentCount: 4,
  },
  {
    id: "issue-36",
    number: 36,
    title: "Crons card seed data uses a stale timezone string",
    body:
      "Two seeded crons claim `America/Denver` but render UTC offsets.\n\nNormalize the seed to one zone so the demo reads cleanly.",
    state: "closed",
    labels: ["bug", "docs"],
    assignees: ["will"],
    commentCount: 1,
  },
  {
    id: "issue-35",
    number: 35,
    title: "Add a diff canvas for the review surface",
    body:
      "The review flow needs a side-by-side diff with file tabs.\n\nShipped behind the `diff` feature card with seeded hunks.",
    state: "closed",
    labels: ["feat", "ui"],
    assignees: ["ada", "will"],
    commentCount: 6,
  },
];

/** Keep only the issues whose state matches the filter; "all" keeps every one. */
export function filterIssues(issues: Issue[], filter: IssueFilter): Issue[] {
  if (filter === "all") return issues.slice();
  return issues.filter((issue) => issue.state === filter);
}

/** Headline counts for the header and the card sub. */
export function summarizeIssues(issues: Issue[]): { total: number; open: number; closed: number } {
  let open = 0;
  let closed = 0;
  for (const issue of issues) {
    if (issue.state === "open") open += 1;
    else closed += 1;
  }
  return { total: issues.length, open, closed };
}

/** Map an issue's state to its tone class: open reads as ok, closed as idle. */
export function toneForIssueState(state: IssueState): string {
  return state === "open" ? "tone-ok" : "tone-idle";
}

/** FNV-1a, kept here so a new issue gets a stable id without Math.random. */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The next issue number, derived from the data: max + 1, or 1 when empty. */
export function nextIssueNumber(issues: Issue[]): number {
  let max = 0;
  for (const issue of issues) {
    if (issue.number > max) max = issue.number;
  }
  return max + 1;
}

/** Prepend a fresh OPEN issue from the draft, returning a new list and the issue. */
export function createIssue(
  issues: Issue[],
  draft: { title: string; body: string },
): { issues: Issue[]; created: Issue } {
  const number = nextIssueNumber(issues);
  const created: Issue = {
    id: `issue-${number}`,
    number,
    title: draft.title,
    body: draft.body,
    state: "open",
    labels: [],
    assignees: [],
    commentCount: 0,
  };
  return { issues: [created, ...issues], created };
}

/** Set the matching issue to closed, returning a new list. */
export function closeIssue(issues: Issue[], number: number): Issue[] {
  return issues.map((issue) =>
    issue.number === number ? { ...issue, state: "closed" } : issue,
  );
}

/** Set the matching issue back to open, returning a new list. */
export function reopenIssue(issues: Issue[], number: number): Issue[] {
  return issues.map((issue) =>
    issue.number === number ? { ...issue, state: "open" } : issue,
  );
}
