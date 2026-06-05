/**
 * A slash command — the CLI in the UI. Each maps to a Smithers feature visible
 * in `smithers --help`; running one opens that feature's default UI as an
 * overlay or hands the rest to the agent. `argHint` drives the autocomplete
 * placeholder (and is where tab-completion of runs/PRs/workflows will plug in).
 */
export type SlashCommand = {
  name: string;
  summary: string;
  /** The Smithers CLI feature / endpoint this maps to. */
  feature: string;
  argHint?: string;
};
