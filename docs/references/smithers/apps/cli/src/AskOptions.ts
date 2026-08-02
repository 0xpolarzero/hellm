import type { SmithersToolSurface } from "@smthrs/agents/agent-contract";

export type AskAgentId = "claude" | "codex" | "kimi" | "antigravity" | "gemini" | "pi";

export type AskOptions = {
    agent?: AskAgentId;
    listAgents?: boolean;
    dumpPrompt?: boolean;
    toolSurface?: SmithersToolSurface;
    noMcp?: boolean;
    printBootstrap?: boolean;
};
