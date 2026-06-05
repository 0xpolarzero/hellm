import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

import { linkPiSkills } from "../src/agent-wiring/linkPiSkills.js";
import { parseAgentWiringArgv } from "../src/agent-wiring/parseAgentWiringArgv.js";
import { registerHermesMcp } from "../src/agent-wiring/registerHermesMcp.js";
import { registerOpenClawMcp } from "../src/agent-wiring/registerOpenClawMcp.js";
import { wireExtraAgents } from "../src/agent-wiring/wireExtraAgents.js";

/** @type {string[]} */
const tempDirs = [];
function tempHome() {
  const dir = mkdtempSync(join(tmpdir(), "smithers-wiring-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

const MCP = { name: "smithers", command: "bunx", args: ["smithers-orchestrator", "--mcp"] };

describe("parseAgentWiringArgv", () => {
  test("recognizes `mcp add` and `skills add`", () => {
    expect(parseAgentWiringArgv(["mcp", "add"])).toEqual({ kind: "mcp", global: true });
    expect(parseAgentWiringArgv(["skills", "add"])).toEqual({ kind: "skills", global: true });
  });

  test("returns null for unrelated commands", () => {
    expect(parseAgentWiringArgv(["mcp"])).toBeNull();
    expect(parseAgentWiringArgv(["up", "workflow.tsx"])).toBeNull();
    expect(parseAgentWiringArgv(["skills", "list"])).toBeNull();
  });

  test("parses --no-global, --agent, and --command", () => {
    expect(parseAgentWiringArgv(["mcp", "add", "--no-global", "--agent", "hermes", "-a", "Cursor"]))
      .toEqual({ kind: "mcp", global: false, agents: ["hermes", "cursor"] });
    expect(parseAgentWiringArgv(["mcp", "add", "--command", "pnpm smithers --mcp"]))
      .toEqual({ kind: "mcp", global: true, command: "pnpm", args: ["smithers", "--mcp"] });
    expect(parseAgentWiringArgv(["skills", "add", "--depth", "2"]))
      .toEqual({ kind: "skills", global: true });
  });
});

describe("registerHermesMcp", () => {
  test("skips when Hermes is not installed", () => {
    const home = tempHome();
    const result = registerHermesMcp({ ...MCP, homeDir: home });
    expect(result).toMatchObject({ agent: "Hermes", registered: false, reason: "not-detected" });
  });

  test("writes the mcp_servers entry into config.yaml", () => {
    const home = tempHome();
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const result = registerHermesMcp({ ...MCP, homeDir: home });
    expect(result.registered).toBe(true);
    const config = parse(readFileSync(result.path, "utf8"));
    expect(config.mcp_servers.smithers).toEqual({ command: "bunx", args: ["smithers-orchestrator", "--mcp"] });
  });

  test("preserves existing config and other servers", () => {
    const home = tempHome();
    mkdirSync(join(home, ".hermes"), { recursive: true });
    writeFileSync(join(home, ".hermes", "config.yaml"), "model: hermes-4\nmcp_servers:\n  other:\n    command: x\n");
    const result = registerHermesMcp({ ...MCP, homeDir: home });
    const config = parse(readFileSync(result.path, "utf8"));
    expect(config.model).toBe("hermes-4");
    expect(config.mcp_servers.other).toEqual({ command: "x" });
    expect(config.mcp_servers.smithers.command).toBe("bunx");
  });
});

describe("registerOpenClawMcp", () => {
  test("skips when OpenClaw is not installed", () => {
    const home = tempHome();
    const result = registerOpenClawMcp({ ...MCP, homeDir: home });
    expect(result).toMatchObject({ agent: "OpenClaw", registered: false, reason: "not-detected" });
  });

  test("writes mcp.servers into openclaw.json and preserves other keys", () => {
    const home = tempHome();
    mkdirSync(join(home, ".openclaw"), { recursive: true });
    writeFileSync(join(home, ".openclaw", "openclaw.json"), JSON.stringify({ channels: { slack: true }, mcp: { servers: { other: { command: "x" } } } }));
    const result = registerOpenClawMcp({ ...MCP, homeDir: home });
    expect(result.registered).toBe(true);
    const config = JSON.parse(readFileSync(result.path, "utf8"));
    expect(config.channels).toEqual({ slack: true });
    expect(config.mcp.servers.other).toEqual({ command: "x" });
    expect(config.mcp.servers.smithers).toEqual({ command: "bunx", args: ["smithers-orchestrator", "--mcp"] });
  });

  test("does not clobber an unparseable config", () => {
    const home = tempHome();
    mkdirSync(join(home, ".openclaw"), { recursive: true });
    const path = join(home, ".openclaw", "openclaw.json");
    writeFileSync(path, "{ /* json5 comment */ mcp: {} }");
    const result = registerOpenClawMcp({ ...MCP, homeDir: home });
    expect(result).toMatchObject({ registered: false, reason: "unparseable-config" });
    expect(readFileSync(path, "utf8")).toContain("json5 comment");
  });
});

describe("linkPiSkills", () => {
  test("skips when Pi is not installed", () => {
    const home = tempHome();
    const result = linkPiSkills({ homeDir: home });
    expect(result).toMatchObject({ agent: "Pi", linked: [], reason: "not-detected" });
  });

  test("copies canonical skills into ~/.pi/agent/skills", () => {
    const home = tempHome();
    mkdirSync(join(home, ".pi"), { recursive: true });
    const canonical = join(home, ".agents", "skills", "smithers");
    mkdirSync(canonical, { recursive: true });
    writeFileSync(join(canonical, "SKILL.md"), "---\nname: smithers\n---\nbody\n");
    const result = linkPiSkills({ homeDir: home });
    expect(result.linked).toEqual(["smithers"]);
    expect(existsSync(join(home, ".pi", "agent", "skills", "smithers", "SKILL.md"))).toBe(true);
  });
});

describe("wireExtraAgents", () => {
  test("mcp kind wires Hermes and OpenClaw when detected", () => {
    const home = tempHome();
    mkdirSync(join(home, ".hermes"), { recursive: true });
    mkdirSync(join(home, ".openclaw"), { recursive: true });
    const results = wireExtraAgents({ kind: "mcp", homeDir: home });
    const wired = results.filter((r) => r.registered).map((r) => r.agent).sort();
    expect(wired).toEqual(["Hermes", "OpenClaw"]);
  });

  test("--agent filter limits which agents are wired", () => {
    const home = tempHome();
    mkdirSync(join(home, ".hermes"), { recursive: true });
    mkdirSync(join(home, ".openclaw"), { recursive: true });
    const results = wireExtraAgents({ kind: "mcp", agents: ["hermes"], homeDir: home });
    expect(results.map((r) => r.agent)).toEqual(["Hermes"]);
  });

  test("skills kind wires Pi", () => {
    const home = tempHome();
    mkdirSync(join(home, ".pi"), { recursive: true });
    const canonical = join(home, ".agents", "skills", "smithers");
    mkdirSync(canonical, { recursive: true });
    writeFileSync(join(canonical, "SKILL.md"), "---\nname: smithers\n---\nbody\n");
    const results = wireExtraAgents({ kind: "skills", homeDir: home });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ agent: "Pi", linked: ["smithers"] });
  });
});
