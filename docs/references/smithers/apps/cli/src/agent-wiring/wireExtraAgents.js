import { homedir } from "node:os";

import { linkPiSkills } from "./linkPiSkills.js";
import { registerHermesMcp } from "./registerHermesMcp.js";
import { registerOpenClawMcp } from "./registerOpenClawMcp.js";

/** Agent ids handled here that the underlying `mcp add` / `skills add` does not reach. */
export const EXTRA_MCP_AGENTS = ["hermes", "openclaw"];
export const EXTRA_SKILL_AGENTS = ["pi"];

/**
 * Wires Smithers into agents the underlying skill/MCP framework does not cover —
 * Hermes and OpenClaw (native MCP config) and Pi (skills directory). Run as a
 * supplementary step after `mcp add` / `skills add`.
 *
 * @param {object} opts
 * @param {"mcp" | "skills"} opts.kind Which install ran.
 * @param {string} [opts.name] MCP server name (default `"smithers"`).
 * @param {string} [opts.command] MCP launch executable (default `"bunx"`).
 * @param {string[]} [opts.args] MCP launch args (default `["smithers-orchestrator", "--mcp"]`).
 * @param {boolean} [opts.global] Install globally (default `true`).
 * @param {string} [opts.cwd] Working directory for project-scoped installs.
 * @param {string[]} [opts.agents] Optional `--agent` filter; when set, only these ids are wired.
 * @param {string} [opts.homeDir] Home directory override (for tests).
 * @returns {Array<{ agent: string; registered?: boolean; linked?: string[]; path: string; reason?: string }>}
 */
export function wireExtraAgents({
  kind,
  name = "smithers",
  command = "bunx",
  args = ["smithers-orchestrator", "--mcp"],
  global = true,
  cwd = process.cwd(),
  agents,
  homeDir = homedir(),
}) {
  const wants = (id) => !agents || agents.includes(id);
  const results = [];

  if (kind === "mcp") {
    if (wants("hermes")) results.push(registerHermesMcp({ name, command, args, homeDir }));
    if (wants("openclaw")) results.push(registerOpenClawMcp({ name, command, args, homeDir }));
  } else if (kind === "skills") {
    if (wants("pi")) results.push(linkPiSkills({ global, cwd, homeDir }));
  }

  return results;
}
