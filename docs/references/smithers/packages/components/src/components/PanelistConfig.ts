import type { AgentLike } from "@smthrs/agents/AgentLike";

export type PanelistConfig = {
	agent: AgentLike;
	role?: string;
	label?: string;
};
