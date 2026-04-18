import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function getSvvyAgentDir(): string {
  return process.platform === "win32"
    ? join(process.env.APPDATA ?? homedir(), "svvy", "pi-agent")
    : join(homedir(), ".config", "svvy", "pi-agent");
}

function getWorkspaceSessionDir(cwd: string): string {
  return join(
    getSvvyAgentDir(),
    "sessions",
    `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`,
  );
}

const workspaceCwd = process.cwd();
const sessionDir = getWorkspaceSessionDir(workspaceCwd);

rmSync(sessionDir, { force: true, recursive: true });
console.log(`Removed workspace session state at ${sessionDir}`);
