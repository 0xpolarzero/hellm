import { ApplicationMenu } from "electrobun/bun";

const QUIT_LABEL = "Smithers Studio";

// Native macOS-style menu bar. Kept minimal: the app menu (quit), standard Edit
// roles so copy/paste/select-all work inside the webview, and Window controls.
export function installApplicationMenu(): void {
  ApplicationMenu.setApplicationMenu([
    {
      label: QUIT_LABEL,
      submenu: [{ role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "bringAllToFront" },
      ],
    },
  ]);
}
