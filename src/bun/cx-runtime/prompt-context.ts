import { CX_SKILL_INSTRUCTIONS } from "../../../generated/cli-instructions.generated";

export function buildCxPromptContext(): string {
  return [
    "Loaded extension: cx semantic code navigation.",
    "",
    "Use `cx` through Shell for semantic code navigation before reading whole files when cx can cover the language.",
    "",
    CX_SKILL_INSTRUCTIONS.trim(),
  ].join("\n");
}
