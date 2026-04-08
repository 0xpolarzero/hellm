import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { renderTuiFrame, type TuiProjection } from "@hellm/tui";
import { runBunModule } from "@hellm/test-support";

const TUI_ENTRY = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const REPO_ROOT = resolve(import.meta.dir, "../../../");

describe("@hellm/tui frame and process rendering", () => {
  it("truncates wide content and respects viewport height without snapshots", () => {
    const projection: TuiProjection = {
      threadsPane: ["thread a", "status completed"],
      episodeInspector: [
        "episode one",
        "conclusion this is a deliberately long line that should be truncated",
      ],
      verificationPanel: ["overall passed"],
      workflowActivity: ["workflow none"],
      footer: ["session /repo"],
    };

    const frame = renderTuiFrame(projection, { width: 24, height: 7 });

    expect(frame).toHaveLength(7);
    expect(frame[0]).toBe("[threads]");
    expect(frame.some((line) => line.endsWith("..."))).toBe(true);
    expect(frame).not.toContain("[footer]");
  });

  it("executes the demo TUI entrypoint as a real process", async () => {
    const result = runBunModule({
      entryPath: TUI_ENTRY,
      cwd: REPO_ROOT,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");
    expect(result.stdout).toContain("[hellm/tui] [threads]");
    expect(result.stdout).toContain("[hellm/tui] [episode]");
    expect(result.stdout).toContain("[hellm/tui] episode none");
    expect(result.stdout).toContain("[hellm/tui] [verification]");
    expect(result.stdout).toContain(`[hellm/tui] session ${REPO_ROOT}`);
    expect(result.stdout).toContain("[hellm/tui] aligned");
  });
});
