import type { WorkflowKind, WorkflowNodeSpec, WorkflowSpec } from "../askme/workflowFlow";

/**
 * The "Create a Workflow" metaworkflow: pure functions that turn a user's
 * one-line goal into a real `WorkflowSpec` the graph can render. Kept free of
 * React and the DOM so the goal→template→spec mapping is unit-tested the same
 * way `workflowFlow.ts` is. The overlay components consume these; they own no
 * logic of their own.
 */

export type TemplateId =
  | "research-plan-implement"
  | "implement"
  | "review"
  | "research"
  | "debug";

/** The workflow being assembled across the build step. */
export type WorkflowDraft = {
  /** The user's own words. Empty is valid — it means "use the default". */
  goal: string;
  templateId: TemplateId;
  /** Insert a human approval gate. */
  withApproval: boolean;
  /** Draw a loop-back edge so the work repeats until the check passes. */
  withLoop: boolean;
  /** The workflow's name; derived from the goal, then editable. */
  name: string;
};

type Stage = { id: string; label: string; kind: WorkflowKind; output: string };

type Template = {
  id: TemplateId;
  label: string;
  blurb: string;
  /** The Workflow Store id this installs on create (see store/workflows.ts). */
  installId: string;
  /** Composer prefix the create step fills, with the goal appended. */
  starter: string;
  /** The trigger node's output — the input the workflow carries. */
  trigger: string;
  /** Stages between the trigger and the result; dependencies are linear. */
  stages: Stage[];
  /** A stage id (or "done") to place the approval gate before. */
  approveBefore: string;
  /** The loop-back edge `withLoop` draws, or null when looping is meaningless. */
  loop: { from: string; to: string; label: string } | null;
};

/** Templates that produce changes — the ones an approval gate defaults on for. */
const WRITING = new Set<TemplateId>(["research-plan-implement", "implement", "debug"]);

/**
 * The starter templates. The default (`research-plan-implement`) is the richest
 * on purpose: a user who doesn't know what they want still sees the full shape
 * of a workflow — research, plan, an approval, the build, a review.
 */
export const TEMPLATES: Record<TemplateId, Template> = {
  "research-plan-implement": {
    id: "research-plan-implement",
    label: "Research → Plan → Implement",
    blurb: "The full loop: gather context, plan it, build it, review it.",
    installId: "research-plan-implement",
    starter: "Research, plan, then implement this:\n\n",
    trigger: "request",
    stages: [
      { id: "research", label: "Research", kind: "agent", output: "context" },
      { id: "plan", label: "Plan", kind: "agent", output: "plan" },
      { id: "implement", label: "Implement", kind: "agent", output: "changes" },
      { id: "review", label: "Review", kind: "agent", output: "review" },
    ],
    approveBefore: "implement",
    loop: { from: "review", to: "implement", label: "needs work" },
  },
  implement: {
    id: "implement",
    label: "Implement",
    blurb: "Build a focused change, then review it.",
    installId: "implement",
    starter: "Implement this change with validation and review:\n\n",
    trigger: "task",
    stages: [
      { id: "implement", label: "Implement", kind: "agent", output: "changes" },
      { id: "review", label: "Review", kind: "agent", output: "review" },
    ],
    approveBefore: "implement",
    loop: { from: "review", to: "implement", label: "fix" },
  },
  review: {
    id: "review",
    label: "Review",
    blurb: "Review the current changes and flag issues.",
    installId: "review",
    starter: "Review these changes and flag bugs and improvements:\n\n",
    trigger: "diff",
    stages: [{ id: "review", label: "Review", kind: "agent", output: "findings" }],
    approveBefore: "done",
    loop: null,
  },
  research: {
    id: "research",
    label: "Research",
    blurb: "Gather context, then synthesize a report.",
    installId: "research",
    starter: "Research this before we build:\n\n",
    trigger: "question",
    stages: [
      { id: "research", label: "Research", kind: "agent", output: "sources" },
      { id: "synthesize", label: "Synthesize", kind: "agent", output: "report" },
    ],
    approveBefore: "done",
    loop: null,
  },
  debug: {
    id: "debug",
    label: "Debug",
    blurb: "Reproduce, fix, then validate a bug.",
    installId: "debug",
    starter: "Reproduce, fix, validate, and review this bug:\n\n",
    trigger: "bug report",
    stages: [
      { id: "reproduce", label: "Reproduce", kind: "compute", output: "repro" },
      { id: "fix", label: "Fix", kind: "agent", output: "patch" },
      { id: "validate", label: "Validate", kind: "compute", output: "tests" },
    ],
    approveBefore: "fix",
    loop: { from: "validate", to: "fix", label: "still failing" },
  },
};

/** Keyword → template, checked most-specific first; the default catches the rest. */
const INTENT_RULES: { test: RegExp; templateId: TemplateId }[] = [
  { test: /\b(review|audit|pr|pull request|diff|code ?review)\b/, templateId: "review" },
  { test: /\b(bug|broken|failing|crash|regression|debug|stack ?trace)\b/, templateId: "debug" },
  {
    test: /\b(research|investigate|compare|explore|find out|look into|learn about)\b/,
    templateId: "research",
  },
  {
    test: /\b(implement|build|add|create|feature|refactor|migrate|rewrite|endpoint|component)\b/,
    templateId: "implement",
  },
];

/** Phrases that mean "I don't know yet" — these take the recommended default. */
const UNSURE = /\b(not sure|no idea|don'?t know|dunno|anything|whatever|unsure|surprise me)\b/;

/** The workflow recommended when the user is unsure or hasn't said. */
export const DEFAULT_TEMPLATE: TemplateId = "research-plan-implement";

/** Pick a starter template from the goal. Unsure or generic falls to the default. */
export function classifyIntent(goal: string): TemplateId {
  const text = goal.trim().toLowerCase();
  if (!text || UNSURE.test(text)) {
    return DEFAULT_TEMPLATE;
  }
  for (const rule of INTENT_RULES) {
    if (rule.test.test(text)) {
      return rule.templateId;
    }
  }
  return DEFAULT_TEMPLATE;
}

/** True when the goal gave Smithers nothing concrete to go on. */
export function isUnsure(goal: string): boolean {
  const text = goal.trim().toLowerCase();
  return !text || UNSURE.test(text);
}

const TITLE_SKIP = new Set(["a", "an", "the", "to", "of", "for", "and", "my", "me"]);

/** A short workflow name from the goal; the template label when there's no goal. */
export function draftToName(draft: WorkflowDraft): string {
  const words = draft.goal
    .trim()
    .replace(/[^\w\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const kept = words.filter((word) => !TITLE_SKIP.has(word.toLowerCase())).slice(0, 4);
  if (kept.length === 0) {
    return TEMPLATES[draft.templateId].label;
  }
  return kept
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ")
    .slice(0, 48);
}

/** The composer prefill the create step hands to the real app: template + goal. */
export function draftToStarter(draft: WorkflowDraft): string {
  return TEMPLATES[draft.templateId].starter + draft.goal.trim();
}

/** A fresh draft for a goal, with sensible toggle defaults for its template. */
export function draftForGoal(goal: string): WorkflowDraft {
  const templateId = classifyIntent(goal);
  const draft: WorkflowDraft = {
    goal: goal.trim(),
    templateId,
    withApproval: WRITING.has(templateId),
    withLoop: false,
    name: "",
  };
  return { ...draft, name: draftToName(draft) };
}

/** The starting draft before any goal is given. */
export const DEFAULT_DRAFT: WorkflowDraft = draftForGoal("");

/** The loop-back edge to draw, or null when the template/toggle has none. */
export function loopBack(
  draft: WorkflowDraft,
): { from: string; to: string; label: string } | null {
  return draft.withLoop ? TEMPLATES[draft.templateId].loop : null;
}

/**
 * Turn the draft into a `WorkflowSpec`: a signal trigger, the template's stages
 * chained linearly, an optional approval gate, and a merge result. The loop-back
 * edge (when enabled) is added by the renderer from `loopBack`, the same way the
 * grill-me graph layers its loop on top of the linear dagre layout.
 */
export function proposeWorkflow(draft: WorkflowDraft): WorkflowSpec {
  const template = TEMPLATES[draft.templateId];
  const nodes: WorkflowNodeSpec[] = [];
  let prev = "start";

  nodes.push({
    id: "start",
    label: "On demand",
    kind: "signal",
    output: template.trigger,
    dependsOn: [],
  });

  const pushApproval = (): void => {
    nodes.push({
      id: "approve",
      label: "Your approval",
      kind: "approval",
      output: "go-ahead",
      dependsOn: [prev],
    });
    prev = "approve";
  };

  for (const stage of template.stages) {
    if (draft.withApproval && template.approveBefore === stage.id) {
      pushApproval();
    }
    nodes.push({ ...stage, dependsOn: [prev] });
    prev = stage.id;
  }
  if (draft.withApproval && template.approveBefore === "done") {
    pushApproval();
  }

  nodes.push({
    id: "done",
    label: "Result",
    kind: "merge",
    output: "result",
    dependsOn: [prev],
  });

  return { name: draft.name || draftToName(draft), description: draft.goal.trim(), nodes };
}
