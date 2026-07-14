import { setTimeout as delay } from "node:timers/promises";
import { readNativeSessionDisplayEnv } from "./diagnostics";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const NATIVE_DIALOG_TITLE_PATTERN = /\b(?:open|select|choose|file)\b/i;

interface XdotoolResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type NativePickerSelectionKind = "file" | "folder";

export interface NativePickerSelectionOptions {
  readonly homeDir?: string;
  readonly kind?: NativePickerSelectionKind;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
}

interface NativePickerWindow {
  readonly id: string;
  readonly title: string;
}

async function runXdotool(
  args: readonly string[],
  nativeDisplayEnv: Record<string, string>,
): Promise<XdotoolResult> {
  const processHandle = Bun.spawn(["xdotool", ...args], {
    env: { ...process.env, ...nativeDisplayEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function visibleWindows(
  nativeDisplayEnv: Record<string, string>,
): Promise<NativePickerWindow[]> {
  const search = await runXdotool(["search", "--onlyvisible", "--name", ".*"], nativeDisplayEnv);
  if (search.exitCode !== 0) return [];

  const windows: NativePickerWindow[] = [];
  for (const id of search.stdout.split(/\s+/).filter(Boolean)) {
    const title = await runXdotool(["getwindowname", id], nativeDisplayEnv);
    if (title.exitCode !== 0) continue;
    windows.push({ id, title: title.stdout.trim() });
  }
  return windows;
}

async function findNativePickerWindow(
  timeoutMs: number,
  pollIntervalMs: number,
  nativeDisplayEnv: Record<string, string>,
): Promise<NativePickerWindow> {
  const deadline = Date.now() + timeoutMs;
  let windows: NativePickerWindow[] = [];
  while (Date.now() < deadline) {
    windows = await visibleWindows(nativeDisplayEnv);
    const dialog = windows.find(({ title }) => NATIVE_DIALOG_TITLE_PATTERN.test(title));
    if (dialog) return dialog;
    await delay(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for the native file picker. Visible X11 windows: ${windows
      .map(({ id, title }) => `${id}:${title || "<untitled>"}`)
      .join(", ")}`,
  );
}

async function windowStillExists(
  id: string,
  nativeDisplayEnv: Record<string, string>,
): Promise<boolean> {
  return (await runXdotool(["getwindowname", id], nativeDisplayEnv)).exitCode === 0;
}

async function waitForPickerClosed(
  id: string,
  timeoutMs: number,
  pollIntervalMs: number,
  nativeDisplayEnv: Record<string, string>,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await windowStillExists(id, nativeDisplayEnv))) return true;
    await delay(pollIntervalMs);
  }
  return !(await windowStillExists(id, nativeDisplayEnv));
}

async function sendPickerKey(
  id: string,
  key: string,
  nativeDisplayEnv: Record<string, string>,
): Promise<void> {
  const result = await runXdotool(["key", key], nativeDisplayEnv);
  if (result.exitCode !== 0 && (await windowStillExists(id, nativeDisplayEnv))) {
    throw new Error(`Could not send ${key} to native file picker: ${result.stderr.trim()}`);
  }
}

/**
 * Completes the real Electrobun Utils.openFileDialog shown by the app.
 *
 * The helper uses the X11 dialog itself rather than touching renderer state or
 * introducing a product-only input. It intentionally selects one path per
 * picker invocation; callers can invoke it repeatedly for a multi-attachment
 * composer draft.
 */
export async function selectNativePickerPath(
  path: string,
  options: NativePickerSelectionOptions = {},
): Promise<void> {
  if (!path.trim()) throw new Error("Native picker path must be non-empty.");
  if (!Bun.which("xdotool")) {
    throw new Error(
      "The OrbStack native picker helper requires xdotool; rerun `bun run setup:e2e` after updating the e2e config.",
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const nativeDisplayEnv: Record<string, string> = options.homeDir
    ? await readNativeSessionDisplayEnv(options.homeDir)
    : {};
  if (process.platform === "linux" && !nativeDisplayEnv.DISPLAY) {
    throw new Error("Native picker automation requires the launched app's isolated HOME path.");
  }
  const picker = await findNativePickerWindow(timeoutMs, pollIntervalMs, nativeDisplayEnv);

  for (const args of [
    // The OrbStack lane deliberately runs Xvfb without a window manager, so
    // _NET_ACTIVE_WINDOW activation is unavailable. XSetInputFocus still gives
    // the real GTK dialog keyboard focus without a renderer-side shortcut.
    ["windowfocus", "--sync", picker.id],
    ["key", "ctrl+l"],
    ["key", "ctrl+a"],
    ["type", "--clearmodifiers", "--delay", "0", path],
  ] as const) {
    const result = await runXdotool(args, nativeDisplayEnv);
    if (result.exitCode !== 0) {
      throw new Error(`Could not drive native file picker: ${result.stderr.trim()}`);
    }
  }

  await sendPickerKey(picker.id, "Return", nativeDisplayEnv);
  if (
    await waitForPickerClosed(
      picker.id,
      Math.min(timeoutMs, 2_000),
      pollIntervalMs,
      nativeDisplayEnv,
    )
  )
    return;

  // GTK folder choosers can first navigate to a path and leave the dialog
  // open. A second Return accepts the now-selected path. This is bounded and
  // only handles the native chooser's documented two-step interaction.
  await sendPickerKey(picker.id, "Return", nativeDisplayEnv);
  if (!(await waitForPickerClosed(picker.id, timeoutMs, pollIntervalMs, nativeDisplayEnv))) {
    throw new Error(
      `Native file picker did not close after selecting ${options.kind ?? "file"} path ${path}.`,
    );
  }
}
