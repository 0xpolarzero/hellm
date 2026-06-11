import type { PreferredExternalEditor } from "../../shared/agent-settings";

const externalEditorLabelById = {
  system: "system default editor",
  code: "Visual Studio Code",
  cursor: "Cursor",
  zed: "Zed",
  sublime: "Sublime Text",
  custom: "custom editor",
} satisfies Record<PreferredExternalEditor, string>;

export function externalEditorLabel(editor: PreferredExternalEditor | null | undefined): string {
  return externalEditorLabelById[editor ?? "system"];
}

export function openExternalEditorTooltip(
  editor: PreferredExternalEditor | null | undefined,
): string {
  return `Open in ${externalEditorLabel(editor)}`;
}
