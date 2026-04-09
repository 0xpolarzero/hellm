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
				<p class="empty-eyebrow">Ready</p>
				<h2>Ask hellm to inspect the repository, make a change, or run verification.</h2>
				<div class="empty-list" aria-hidden="true">
					<p>Review the repo and summarize the architecture.</p>
					<p>Implement a change and explain the diff.</p>
					<p>Run the relevant checks and report failures.</p>
				</div>
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
		background: transparent;
	}

	.chat-thread {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		max-width: 60rem;
		margin: 0 auto 0 0;
		padding: 0.85rem 0.8rem 0.75rem;
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
		position: relative;
		width: min(100%, 48rem);
		padding: 0.82rem 0.9rem;
		border-radius: var(--ui-radius-md);
		border: none;
		box-shadow: none;
		overflow: visible;
	}

	.user-bubble {
		width: min(100%, 39rem);
		background: color-mix(in oklab, var(--ui-accent-soft) 76%, var(--ui-bg-elevated));
	}

	.assistant-bubble {
		padding-left: 1.1rem;
		border-left: 2px solid color-mix(in oklab, var(--ui-border-strong) 70%, transparent);
		background: transparent;
		border-radius: 0;
	}

	.tool-result {
		padding-left: 1.1rem;
		border-left: 2px solid color-mix(in oklab, var(--ui-accent) 82%, var(--ui-accent-strong));
		background: color-mix(in oklab, var(--ui-surface-subtle) 58%, transparent);
		border-radius: 0;
	}

	.streaming {
		border-left-style: dashed;
		animation: none;
	}

	.message-bubble header,
	.tool-result-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.9rem;
		margin-bottom: 0.65rem;
	}

	.message-bubble header span,
	.tool-result-header strong {
		font-size: 0.82rem;
		font-weight: 760;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ui-text-primary);
	}

	.message-bubble header small,
	.tool-result-header span,
	time {
		font-size: 0.74rem;
		color: var(--ui-text-secondary);
		font-variant-numeric: tabular-nums;
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
		line-height: 1.6;
		color: var(--ui-text-primary);
	}

	.thinking-block,
	.result-details {
		margin-top: 0.65rem;
		padding: 0.7rem 0.8rem;
		border-radius: 0;
		border: none;
		border-top: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
		background: color-mix(in oklab, var(--ui-surface-muted) 58%, transparent);
	}

	.thinking-block summary,
	.result-details summary {
		cursor: pointer;
		font-size: 0.78rem;
		font-weight: 720;
		letter-spacing: 0.05em;
		color: var(--ui-text-secondary);
	}

	.thinking-block pre,
	.result-details pre {
		margin-top: 0.65rem;
		font-size: 0.82rem;
		color: var(--ui-text-secondary);
	}

	.tool-card {
		position: relative;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.8rem;
		margin-top: 0.65rem;
		padding: 0.72rem 0.8rem;
		border-radius: 0;
		border: none;
		border-left: 2px solid color-mix(in oklab, var(--ui-accent) 84%, var(--ui-accent-strong));
		background: color-mix(in oklab, var(--ui-surface-muted) 62%, transparent);
		overflow: visible;
	}

	.tool-card::before,
	.tool-result::before {
		content: none;
	}

	.tool-card.error,
	.tool-result.error {
		background: var(--ui-danger-soft);
	}

	.tool-card.error,
	.tool-result.error {
		border-left-color: var(--ui-danger);
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
		font-size: 0.86rem;
		font-weight: 700;
		color: var(--ui-text-primary);
	}

	.tool-card-copy span {
		font-family: var(--font-mono);
		font-size: 0.76rem;
		color: var(--ui-text-secondary);
	}

	.empty-state {
		padding: clamp(2.1rem, 7vw, 3.6rem) 0 2rem;
		max-width: 44rem;
		color: var(--ui-text-secondary);
	}

	.empty-eyebrow {
		margin: 0 0 0.3rem;
		font-size: 0.68rem;
		font-weight: 760;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--ui-accent-strong);
	}

	.empty-state h2 {
		margin: 0;
		max-width: 38rem;
		font-size: clamp(1.2rem, 2vw, 1.65rem);
		font-weight: 680;
		letter-spacing: -0.045em;
		color: var(--ui-text-primary);
	}

	.empty-list {
		display: grid;
		gap: 0.45rem;
		margin-top: 0.75rem;
		padding-left: 1rem;
		border-left: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
	}

	.empty-list p {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.55;
		color: var(--ui-text-secondary);
	}

	@media (max-width: 720px) {
		.chat-thread {
			padding-inline: 0.65rem;
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

		.empty-state {
			padding-top: 3rem;
		}
	}
</style>
