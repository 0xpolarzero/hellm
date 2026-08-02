import type { AgentLike } from "@smthrs/agents/AgentLike";

export type CheckConfig = {
	id: string;
	agent?: AgentLike;
	command?: string;
	label?: string;
};
