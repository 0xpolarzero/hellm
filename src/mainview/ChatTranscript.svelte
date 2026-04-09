<script lang="ts">
	import type { AgentMessage } from "@mariozechner/pi-agent-core";
	import type { AssistantMessage, Message, ToolCall, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
	import { tick } from "svelte";
	import {
		buildArtifactResultsMap,
		buildArtifactsToolCallMap,
		getArtifactCommandCopy,
		parseArtifactsParams,
	} from "./artifacts";
	import { formatTimestamp, formatUsage } from "./chat-format";
	import Button from "./ui/Button.svelte";
	import Badge from "./ui/Badge.svelte";

	type Props = {
		messages: AgentMessage[];
		streamingMessage?: AgentMessage;
		pendingToolCalls: ReadonlySet<string>;
		isStreaming: boolean;
		onOpenArtifact: (filename: string) => void;
	};

	let { messages, streamingMessage, pendingToolCalls, isStreaming, onOpenArtifact }: Props = $props();

	let scroller = $state<HTMLDivElement | null>(null);
	let autoScroll = $state(true);

	function isStandardMessage(message: AgentMessage): message is Message {
		return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
	}

	function isAssistantMessage(message: AgentMessage | undefined): message is AssistantMessage {
		return !!message && message.role === "assistant";
	}

	function userLines(message: UserMessage): string[] {
		if (typeof message.content === "string") return [message.content];
		return message.content.map((block) => (block.type === "text" ? block.text : `[${block.mimeType} image]`));
	}

	function toolResultText(message: ToolResultMessage): string {
		return message.content
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("\n")
			.trim();
	}

	function resultDetailsText(message: ToolResultMessage): string {
		return artifactResultTextById.get(message.toolCallId) || toolResultText(message);
	}

	function toolStatus(toolCallId: string, toolResultsById: Map<string, ToolResultMessage>): "pending" | "error" | "done" {
		const result = toolResultsById.get(toolCallId);
		if (result?.isError) return "error";
		if (result) return "done";
		return pendingToolCalls.has(toolCallId) ? "pending" : "pending";
	}

	const visibleMessages = $derived(messages.filter(isStandardMessage));
	const toolCallsById = $derived(buildArtifactsToolCallMap(messages));
	const artifactResultTextById = $derived(buildArtifactResultsMap(messages));
	const toolResultsById = $derived.by(() => {
		const results = new Map<string, ToolResultMessage>();
		for (const message of visibleMessages) {
			if (message.role === "toolResult") {
				results.set(message.toolCallId, message);
			}
		}
		return results;
	});
	const streamingAssistant = $derived(isAssistantMessage(streamingMessage) ? streamingMessage : null);

	function handleScroll() {
		if (!scroller) return;
		const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
		autoScroll = distanceFromBottom < 48;
	}

	$effect(() => {
		void visibleMessages;
		void streamingAssistant;
		void pendingToolCalls;
		void isStreaming;

		if (!scroller || !autoScroll) return;
		void tick().then(() => {
			if (!scroller) return;
			scroller.scrollTop = scroller.scrollHeight;
		});
	});
</script>

<div bind:this={scroller} class="chat-transcript" onscroll={handleScroll}>
	<div class="chat-thread">
		{#if visibleMessages.length === 0 && !streamingAssistant}
			<div class="empty-state">
				<p class="empty-eyebrow">Workspace Ready</p>
				<h2>Start a task</h2>
				<p>Ask for a code change, a review, or a verification run. The Bun-side pi host is already connected.</p>
			</div>
		{/if}

		{#each visibleMessages as message, index (`${message.role}:${message.timestamp}:${index}`)}
			{#if message.role === "user"}
				<article class="message-row user-row">
					<div class="message-bubble user-bubble">
						<header>
							<span>You</span>
							<time>{formatTimestamp(message.timestamp)}</time>
						</header>
						{#each userLines(message) as line, lineIndex (`${message.timestamp}:line:${lineIndex}`)}
							<pre>{line}</pre>
						{/each}
					</div>
				</article>
			{:else if message.role === "assistant"}
				<article class="message-row assistant-row">
					<div class="message-bubble assistant-bubble">
						<header>
							<div>
								<span>hellm</span>
								<small>{message.provider} · {message.model}</small>
							</div>
							<div class="message-meta">
								{#if formatUsage(message.usage)}
									<Badge>{formatUsage(message.usage)}</Badge>
								{/if}
								<time>{formatTimestamp(message.timestamp)}</time>
							</div>
						</header>

						{#each message.content as block, blockIndex (`${message.timestamp}:block:${blockIndex}`)}
							{#if block.type === "text"}
								<pre>{block.text}</pre>
							{:else if block.type === "thinking"}
								<details class="thinking-block">
									<summary>Reasoning trace</summary>
									<pre>{block.thinking || "[redacted]"}</pre>
								</details>
							{:else if block.type === "toolCall"}
								{@const params = parseArtifactsParams(block.arguments)}
								{@const status = toolStatus(block.id, toolResultsById)}
								<div class={`tool-card ${status}`.trim()}>
									<div class="tool-card-copy">
										<strong>
											{params ? getArtifactCommandCopy(params.command).complete : `Ran ${block.name}`}
										</strong>
										{#if params}
											<span>{params.filename}</span>
										{:else}
											<span>{block.name}</span>
										{/if}
									</div>
									<div class="tool-card-actions">
										<Badge tone={status === "error" ? "danger" : status === "done" ? "success" : "warning"}>
											{status}
										</Badge>
										{#if params}
											<Button size="sm" variant="ghost" onclick={() => onOpenArtifact(params.filename)}>
												Open
											</Button>
										{/if}
									</div>
								</div>
							{/if}
						{/each}
					</div>
				</article>
			{:else if message.role === "toolResult"}
				{@const params = toolCallsById.get(message.toolCallId)}
				<article class="message-row tool-row">
					<div class={`tool-result ${message.isError ? "error" : ""}`.trim()}>
						<div class="tool-result-header">
							<div>
								<strong>
									{params ? getArtifactCommandCopy(params.command).complete : `Tool ${message.toolName}`}
								</strong>
								{#if params}
									<span>{params.filename}</span>
								{/if}
							</div>
							<div class="tool-result-actions">
								<Badge tone={message.isError ? "danger" : "success"}>
									{message.isError ? "Error" : "Complete"}
								</Badge>
								{#if params}
									<Button size="sm" variant="ghost" onclick={() => onOpenArtifact(params.filename)}>Open</Button>
								{/if}
							</div>
						</div>
						{#if resultDetailsText(message)}
							<details class="result-details">
								<summary>{message.isError ? "Error output" : "Tool output"}</summary>
								<pre>{resultDetailsText(message)}</pre>
							</details>
						{/if}
					</div>
				</article>
			{/if}
		{/each}

		{#if streamingAssistant}
			<article class="message-row assistant-row">
				<div class="message-bubble assistant-bubble streaming">
					<header>
						<div>
							<span>hellm</span>
							<small>{streamingAssistant.provider} · {streamingAssistant.model}</small>
						</div>
						<Badge tone="warning">Streaming</Badge>
					</header>

					{#each streamingAssistant.content as block, blockIndex (`streaming:${blockIndex}`)}
						{#if block.type === "text"}
							<pre>{block.text}</pre>
						{:else if block.type === "thinking"}
							<details class="thinking-block" open>
								<summary>Reasoning trace</summary>
								<pre>{block.thinking || "[redacted]"}</pre>
							</details>
						{:else if block.type === "toolCall"}
							{@const params = parseArtifactsParams(block.arguments)}
							<div class="tool-card pending">
								<div class="tool-card-copy">
									<strong>
										{params ? getArtifactCommandCopy(params.command).inProgress : `Running ${block.name}`}
									</strong>
									{#if params}
										<span>{params.filename}</span>
									{:else}
										<span>{block.name}</span>
									{/if}
								</div>
								<Badge tone="warning">pending</Badge>
							</div>
						{/if}
					{/each}
				</div>
			</article>
		{/if}
	</div>
</div>

<style>
	.chat-transcript {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.chat-thread {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		max-width: 56rem;
		margin: 0 auto;
		padding: 1rem 1rem 0.9rem;
	}

	.message-row {
		display: flex;
	}

	.user-row {
		justify-content: flex-end;
	}

	.assistant-row,
	.tool-row {
		justify-content: flex-start;
	}

	.message-bubble,
	.tool-result {
		width: min(100%, 44rem);
		padding: 0.9rem 1rem;
		border-radius: calc(var(--ui-radius-xl) - 0.1rem);
		border: 1px solid rgba(203, 213, 225, 0.82);
		box-shadow: 0 18px 34px rgba(15, 23, 42, 0.05);
	}

	.user-bubble {
		background: linear-gradient(135deg, rgba(14, 116, 144, 0.1), rgba(20, 184, 166, 0.08)), rgba(255, 255, 255, 0.92);
	}

	.assistant-bubble,
	.tool-result {
		background: rgba(255, 255, 255, 0.88);
	}

	.streaming {
		border-style: dashed;
	}

	.message-bubble header,
	.tool-result-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.8rem;
		margin-bottom: 0.72rem;
	}

	.message-bubble header span,
	.tool-result-header strong {
		font-size: 0.88rem;
		font-weight: 740;
		color: var(--ui-text-primary);
	}

	.message-bubble header small,
	.tool-result-header span,
	time {
		font-size: 0.75rem;
		color: var(--ui-text-secondary);
	}

	.message-meta,
	.tool-result-actions {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	pre {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		font-family: inherit;
		font-size: 0.9rem;
		line-height: 1.65;
		color: var(--ui-text-primary);
	}

	.thinking-block,
	.result-details {
		margin-top: 0.7rem;
		padding: 0.75rem 0.82rem;
		border-radius: calc(var(--ui-radius-md) + 0.06rem);
		background: rgba(248, 250, 252, 0.92);
	}

	.thinking-block summary,
	.result-details summary {
		cursor: pointer;
		font-size: 0.78rem;
		font-weight: 680;
		color: var(--ui-text-secondary);
	}

	.thinking-block pre,
	.result-details pre {
		margin-top: 0.65rem;
		font-size: 0.82rem;
		color: #1e293b;
	}

	.tool-card {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.8rem;
		margin-top: 0.7rem;
		padding: 0.78rem 0.86rem;
		border-radius: calc(var(--ui-radius-md) + 0.06rem);
		border: 1px solid rgba(203, 213, 225, 0.76);
		background: rgba(248, 250, 252, 0.9);
	}

	.tool-card.error,
	.tool-result.error {
		border-color: rgba(248, 113, 113, 0.34);
		background: rgba(254, 242, 242, 0.94);
	}

	.tool-card-copy,
	.tool-card-actions {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.tool-card-copy {
		flex-direction: column;
	}

	.tool-card-copy strong {
		font-size: 0.85rem;
		font-weight: 720;
		color: var(--ui-text-primary);
	}

	.tool-card-copy span {
		font-family: "SF Mono", "Menlo", monospace;
		font-size: 0.76rem;
		color: var(--ui-text-secondary);
	}

	.empty-state {
		padding: 3.4rem 1rem 2.8rem;
		text-align: center;
		color: var(--ui-text-secondary);
	}

	.empty-eyebrow {
		margin: 0 0 0.3rem;
		font-size: 0.72rem;
		font-weight: 760;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ui-accent-strong);
	}

	.empty-state h2 {
		margin: 0;
		font-size: 1.18rem;
		font-weight: 730;
		color: var(--ui-text-primary);
	}

	.empty-state p:last-child {
		max-width: 32rem;
		margin: 0.45rem auto 0;
		line-height: 1.6;
	}

	@media (max-width: 720px) {
		.chat-thread {
			padding-inline: 0.85rem;
		}

		.message-bubble header,
		.tool-result-header,
		.tool-card {
			flex-direction: column;
			align-items: stretch;
		}

		.message-meta,
		.tool-result-actions {
			justify-content: flex-start;
		}
	}
</style>
