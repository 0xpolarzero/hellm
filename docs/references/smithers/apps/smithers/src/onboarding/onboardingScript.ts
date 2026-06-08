import { TEMPLATES, isUnsure, type WorkflowDraft } from "./createWorkflowFlow";

/**
 * The words Smithers says during onboarding. Kept here as pure data so the copy
 * is reviewable in one place and the components that render it hold no strings.
 * This is also the seam where a streamed model reply would slot in later; the
 * deterministic lines below are what make the first run work with no network.
 */

export type ScriptLine = { id: string; text: string };

/**
 * The intro: who Smithers is and what a workflow is, one idea per line so they
 * reveal in sequence. The last line asks the one question onboarding needs.
 */
export const WELCOME_LINES: ScriptLine[] = [
  { id: "hello", text: "Hi, I'm Smithers, a durable runtime for agents." },
  {
    id: "what",
    text: "I run workflows. A workflow is a small graph of steps: agents that do the work, checks that gate it, and approvals you hold. It runs durably, so when a step fails it resumes instead of starting over.",
  },
  {
    id: "ask",
    text: "Let's build your first one. In a sentence, what would you like a workflow to do for you?",
  },
];

/**
 * Smithers' reply once the user states a goal. When the goal is vague it
 * recommends the default and says why; otherwise it names the matched template
 * and hands off to the builder.
 */
export function goalResponse(draft: WorkflowDraft): ScriptLine[] {
  const template = TEMPLATES[draft.templateId];
  if (isUnsure(draft.goal)) {
    return [
      { id: "ok", text: "No problem, most people start here." },
      {
        id: "rec",
        text: `I'll set you up with a ${template.label} workflow. ${template.blurb} It shows the whole shape of a workflow, so it's the best way to feel out what Smithers can do.`,
      },
      { id: "next", text: "Here's what I'd run. Tweak it below, then create it." },
    ];
  }
  return [
    { id: "got", text: `Got it: "${draft.goal}".` },
    {
      id: "rec",
      text: `That's a good fit for a ${template.label} workflow. ${template.blurb}`,
    },
    { id: "next", text: "Here's what I'd run. Tweak it below, then create it." },
  ];
}

/** The example goals offered as one-tap chips when the user is staring at a blank box. */
export const GOAL_SUGGESTIONS: string[] = [
  "Implement a feature from a ticket",
  "Review my open pull request",
  "Research how to migrate to a new library",
  "Reproduce and fix a failing test",
  "I'm not sure yet",
];
