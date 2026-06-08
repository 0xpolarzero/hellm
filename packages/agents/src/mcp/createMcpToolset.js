import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dynamicTool, jsonSchema } from "ai";

/** @typedef {import("./McpServerConfig.ts").McpServerConfig} McpServerConfig */
/** @typedef {import("./McpToolset.ts").McpToolset} McpToolset */

/**
 * Options for shaping the generated toolset. Mirrors the curation knobs on
 * `createOpenApiTools` so MCP and OpenAPI integrations feel the same.
 *
 * @typedef {object} McpToolsetOptions
 * @property {string[]} [include] Only expose these MCP tool names.
 * @property {string[]} [exclude] Drop these MCP tool names.
 * @property {string} [namePrefix] Prefix applied to every tool name (e.g. `"github_"`).
 * @property {string} [clientName] Identifies this client to the server.
 * @property {string} [clientVersion] Client version reported to the server.
 */

/**
 * Connect to an MCP server and expose its tools as AI SDK tools an agent can call.
 *
 * This is the inbound half of MCP-as-integration: declare a server, get back a
 * `Record<string, Tool>` to hand to an SDK agent's `tools`. Each generated tool
 * proxies to the server via `tools/call` on demand, so the agent discovers and
 * invokes them mid reasoning loop. The returned `close()` MUST be called to
 * disconnect and terminate the spawned server process.
 *
 * @param {McpServerConfig} config
 * @param {McpToolsetOptions} [options]
 * @returns {Promise<McpToolset>}
 */
export async function createMcpToolset(config, options = {}) {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    ...(config.env ? { env: config.env } : {}),
    ...(config.cwd ? { cwd: config.cwd } : {}),
    stderr: "pipe",
  });
  const client = new Client({
    name: options.clientName ?? "smithers-mcp-toolset",
    version: options.clientVersion ?? "0.0.0",
  });
  await client.connect(transport);

  const prefix = options.namePrefix ?? "";
  const listed = await client.listTools();
  /** @type {Record<string, import("ai").Tool>} */
  const tools = {};
  for (const mcpTool of listed.tools) {
    if (options.include && !options.include.includes(mcpTool.name)) continue;
    if (options.exclude && options.exclude.includes(mcpTool.name)) continue;
    tools[`${prefix}${mcpTool.name}`] = dynamicTool({
      description: mcpTool.description ?? mcpTool.name,
      inputSchema: jsonSchema(/** @type {any} */ (mcpTool.inputSchema ?? { type: "object", properties: {} })),
      execute: async (input) => callMcpTool(client, mcpTool.name, input),
    });
  }

  return {
    tools,
    toolNames: Object.keys(tools),
    close: () => client.close(),
  };
}

/**
 * Invoke one MCP tool and reduce its result to a value the model can read:
 * structured content when the server returns it, otherwise the joined text.
 *
 * @param {Client} client
 * @param {string} name
 * @param {unknown} input
 * @returns {Promise<unknown>}
 */
async function callMcpTool(client, name, input) {
  const result = await client.callTool({
    name,
    arguments: /** @type {Record<string, unknown>} */ (input ?? {}),
  });
  const parts = Array.isArray(result.content) ? result.content : [];
  let text = "";
  for (const part of parts) {
    const item = /** @type {{ type?: string; text?: string }} */ (part);
    if (item.type === "text" && typeof item.text === "string") {
      text += text ? `\n${item.text}` : item.text;
    }
  }
  if (result.isError) {
    return { error: true, message: text || `MCP tool "${name}" failed`, status: "failed" };
  }
  return result.structuredContent ?? text;
}
