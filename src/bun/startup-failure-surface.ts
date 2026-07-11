import { normalizeDesktopBridgeErrorContract, type DesktopBridgeErrorContract } from "@svvy/core";

const startupFailureTitle = "svvy couldn't start";
const startupFailureMessage = "The desktop runtime is unavailable. Close & reopen svvy to retry.";

export interface StartupFailurePresentation {
  readonly error: DesktopBridgeErrorContract;
  readonly title: string;
  readonly message: string;
  readonly text: string;
  readonly html: string;
}

export interface StartupFailureSurfaceHost {
  showStartupFailure(presentation: StartupFailurePresentation): Promise<void>;
}

export function normalizeStartupFailure(_cause: unknown): DesktopBridgeErrorContract {
  return normalizeDesktopBridgeErrorContract({
    operation: "desktop.startup",
    reason: "desktop-shutdown",
    message: startupFailureMessage,
  });
}

export function createStartupFailurePresentation(cause: unknown): StartupFailurePresentation {
  const error = normalizeStartupFailure(cause);
  const text = `${startupFailureTitle}\n\n${error.message}`;

  return {
    error,
    title: startupFailureTitle,
    message: error.message,
    text,
    html: [
      '<main role="alert">',
      `<h1>${escapeHtml(startupFailureTitle)}</h1>`,
      `<p>${escapeHtml(error.message)}</p>`,
      "</main>",
    ].join(""),
  };
}

export async function showStartupFailureSurface(input: {
  readonly cause: unknown;
  readonly host: StartupFailureSurfaceHost;
}): Promise<StartupFailurePresentation> {
  const presentation = createStartupFailurePresentation(input.cause);
  await input.host.showStartupFailure(presentation);
  return presentation;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
