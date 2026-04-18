export function resolveWorkspaceCwd(): string {
  return process.env.SVVY_WORKSPACE_CWD ?? process.env.INIT_CWD ?? process.env.PWD ?? process.cwd();
}
