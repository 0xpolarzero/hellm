import { getE2eWorkspaceCwdOverride } from "./e2e-control";

export function resolveWorkspaceCwd(): string {
  return getE2eWorkspaceCwdOverride() ?? process.cwd();
}
