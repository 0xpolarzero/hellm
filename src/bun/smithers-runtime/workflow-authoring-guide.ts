const HANDLER_WORKFLOW_AUTHORING_GUIDE_LINES = [
  "Workflow authoring guide for handler threads:",
  "- First decide whether direct work in execute_typescript is enough.",
  "- If a workflow is justified, check runnable saved entries through smithers.list_workflows and reusable saved assets through api.workflow.listAssets(...).",
  "- Reuse a saved runnable entry when one clearly fits. Otherwise author a short-lived artifact workflow under .svvy/artifacts/workflows/<artifact_workflow_id>/.",
  "- Only write reusable saved workflow files into .svvy/workflows/ when the user explicitly asks for reusable pieces to be saved.",
  "- Use the normal api.repo.writeFile(...) or api.repo.writeJson(...) helpers to create or update files under .svvy/workflows/.",
  "- Writes under .svvy/workflows/ automatically trigger saved-workflow validation. Diagnostics are surfaced through captured console logs in the enclosing execute_typescript result.",
  "- Temporary validation errors are acceptable while you are editing related files one by one. The final saved workflow state must validate cleanly before you treat it as complete.",
].join("\n");

const HANDLER_WORKFLOW_AUTHORING_EXAMPLES_LINES = [
  "Example: inspect reusable assets before authoring",
  "```ts",
  'const definitions = await api.workflow.listAssets({ kind: "definition", scope: "saved" });',
  'const profiles = await api.workflow.listAssets({ kind: "component", subtype: "agent-profile", scope: "saved" });',
  "const models = await api.workflow.listModels();",
  "```",
  "",
  "Example: write one reusable prompt and component into the saved workflow library",
  "```ts",
  "await api.repo.writeFile({",
  '  path: ".svvy/workflows/prompts/oauth-review-base.mdx",',
  "  text: `---\\nsvvyAssetKind: prompt\\nsvvyId: oauth_review_base\\ntitle: OAuth Review Base\\nsummary: Base prompt for reusable OAuth reviews.\\n---\\nReview the implementation against the stated objective.`,",
  "  createDirectories: true,",
  "});",
  "",
  "await api.repo.writeFile({",
  '  path: ".svvy/workflows/components/oauth-security-reviewer.ts",',
  "  text: `/**\\n * @svvyAssetKind component\\n * @svvyId oauth_security_reviewer\\n * @svvyTitle OAuth Security Reviewer\\n * @svvySummary Reusable OAuth security reviewer profile.\\n * @svvySubtype agent-profile\\n * @svvyProviderModelSummary openai/gpt-5.4\\n * @svvyToolsetSummary execute_typescript\\n */\\nexport const oauthSecurityReviewer = {};`,",
  "  createDirectories: true,",
  "});",
  "```",
].join("\n");

export const HANDLER_WORKFLOW_AUTHORING_APPENDIX = [
  HANDLER_WORKFLOW_AUTHORING_GUIDE_LINES,
  "",
  HANDLER_WORKFLOW_AUTHORING_EXAMPLES_LINES,
].join("\n");
