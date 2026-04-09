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
				<div class="empty-prompts" aria-hidden="true">
					<span>Inspect the repository</span>
					<span>Implement a change</span>
					<span>Run verification</span>
					<span>Review a diff</span>
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
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-panel-accent) 34%, transparent), transparent 8rem);
	}

	.chat-thread {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 60rem;
		margin: 0 auto 0 0;
		padding: 1.15rem 1.1rem 1rem;
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
		padding: 1rem 1.05rem;
		border-radius: var(--ui-radius-md);
		border: none;
		box-shadow: none;
		overflow: visible;
	}

	.user-bubble {
		width: min(100%, 39rem);
		background:
			linear-gradient(135deg, color-mix(in oklab, var(--ui-accent-soft) 92%, transparent), color-mix(in oklab, var(--ui-bg-elevated) 96%, transparent));
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
		background: color-mix(in oklab, var(--ui-surface-subtle) 74%, transparent);
		border-radius: 0;
	}

	.streaming {
		border-left-style: dashed;
		animation: streamPulse 1.9s ease-out infinite;
	}

	.message-bubble header,
	.tool-result-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.9rem;
		margin-bottom: 0.8rem;
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
		font-size: 0.96rem;
		line-height: 1.65;
		color: var(--ui-text-primary);
	}

	.thinking-block,
	.result-details {
		margin-top: 0.8rem;
		padding: 0.85rem 0.9rem;
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
		margin-top: 0.8rem;
		padding: 0.85rem 0.92rem;
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
		padding: clamp(3.5rem, 10vw, 6rem) 0 3rem;
		max-width: 38rem;
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
		font-size: clamp(1.6rem, 3vw, 2.4rem);
		font-weight: 730;
		letter-spacing: -0.045em;
		color: var(--ui-text-primary);
	}

	.empty-state p:last-child {
		max-width: 32rem;
		margin: 0.55rem 0 0;
		font-size: 0.96rem;
		line-height: 1.6;
	}

	.empty-prompts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
		margin-top: 1rem;
	}

	.empty-prompts span {
		padding: 0.52rem 0.72rem;
		border-radius: var(--ui-radius-sm);
		border: none;
		background: color-mix(in oklab, var(--ui-surface-subtle) 72%, transparent);
		font-size: 0.76rem;
		font-weight: 650;
		letter-spacing: 0.03em;
		color: var(--ui-text-secondary);
	}

	@keyframes streamPulse {
		0%,
		100% {
			box-shadow: 0 12px 28px color-mix(in oklab, black 6%, transparent);
		}

		50% {
			box-shadow: 0 16px 34px color-mix(in oklab, var(--ui-accent) 12%, transparent);
		}
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

		.empty-state {
			padding-top: 3rem;
		}
	}
</style>
