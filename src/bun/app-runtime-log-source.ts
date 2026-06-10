import type { AppLogSource } from "../shared/workspace-contract";

export type AppRuntimeLogKind = "app" | "rpc";

export function mapAppRuntimeLogSource(source: string, kind?: AppRuntimeLogKind): AppLogSource {
  if (kind === "rpc" || source.includes("rpc")) return "app.rpc";
  if (source.includes("auth") || source.includes("oauth")) return "auth.provider";
  if (source.includes("sendPrompt")) return "prompt";
  if (source.includes("session")) return "session";
  if (source.includes("surface")) return "surface";
  if (source.includes("workflow")) return "workflow.library";
  if (source.includes("editor")) return "external-editor";
  if (source.includes("dev-browser-tools")) return "app.bridge";
  if (source.includes("renderer")) return "renderer";
  if (source.includes("settings")) return "settings";
  return "app.lifecycle";
}
