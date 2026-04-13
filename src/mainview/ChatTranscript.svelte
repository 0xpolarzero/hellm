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

	type Props = {
		messages: AgentMessage[];
		streamMessage?: AgentMessage;
		pendingToolCalls: ReadonlySet<string>;
		isStreaming: boolean;
		onOpenArtifact: (filename: string) => void;
	};

	let { messages, streamMessage, pendingToolCalls, isStreaming, onOpenArtifact }: Props = $props();

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
	const streamingAssistant = $derived(isAssistantMessage(streamMessage) ? streamMessage : null);

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
		{#each visibleMessages as message, index (`${message.role}:${message.timestamp}:${index}`)}
			{#if message.role === "user"}
				<article class="message-row user-row">
					<div class="message-bubble user-bubble">
						<header>
							<span>You</span>
							<time>{formatTimestamp(message.timestamp)}</time>
						</header>
						{#each userLines(message) as line, lineIndex (`${message.timestamp}:line:${lineIndex}`)}
							<p class="message-text">{line}</p>
						{/each}
					</div>
				</article>
			{:else if message.role === "assistant"}
				<article class="message-row assistant-row">
					<div class="message-bubble assistant-bubble">
						<header>
							<div>
								<span>svvy</span>
								<small>{message.provider} · {message.model}</small>
							</div>
							<div class="message-meta">
								{#if formatUsage(message.usage)}
									<span class="message-usage">{formatUsage(message.usage)}</span>
								{/if}
								<time>{formatTimestamp(message.timestamp)}</time>
							</div>
						</header>

						{#each message.content as block, blockIndex (`${message.timestamp}:block:${blockIndex}`)}
							{#if block.type === "text"}
								<div class="message-text">{block.text}</div>
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
										<span class={`tool-status tone-${status === "error" ? "danger" : status === "done" ? "success" : "warning"}`.trim()}>
											{status}
										</span>
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
								<span class={`tool-status tone-${message.isError ? "danger" : "success"}`.trim()}>
									{message.isError ? "Error" : "Complete"}
								</span>
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
							<span>svvy</span>
							<small>{streamingAssistant.provider} · {streamingAssistant.model}</small>
						</div>
						<span class="tool-status tone-warning">Streaming</span>
					</header>

					{#each streamingAssistant.content as block, blockIndex (`streaming:${blockIndex}`)}
						{#if block.type === "text"}
							<div class="message-text">{block.text}</div>
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
								<span class="tool-status tone-warning">pending</span>
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
		gap: 1rem;
		width: min(100%, 72rem);
		margin: 0 auto;
		padding: 1.15rem clamp(1rem, 3vw, 2rem) 1.35rem;
	}

	.message-row {
		display: flex;
		width: 100%;
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
		width: min(100%, 58rem);
		padding: 0.95rem 1rem;
		border-radius: var(--ui-radius-lg);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		background: var(--ui-surface-raised);
		box-shadow: var(--ui-shadow-soft);
		overflow: visible;
	}

	.user-bubble {
		width: min(100%, 44rem);
		border-color: color-mix(in oklab, var(--ui-border-accent) 68%, var(--ui-border-soft));
		background:
			linear-gradient(180deg, color-mix(in oklab, white 18%, transparent), transparent),
			color-mix(in oklab, var(--ui-accent-soft) 78%, var(--ui-surface-raised));
	}

	.assistant-bubble {
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-surface-raised) 72%, transparent), transparent),
			var(--ui-surface);
	}

	.tool-result {
		border-color: color-mix(in oklab, var(--ui-border-accent) 72%, var(--ui-border-soft));
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-accent-soft) 36%, transparent), transparent),
			var(--ui-surface-raised);
	}

	.streaming {
		border-style: dashed;
	}

	.message-bubble header,
	.tool-result-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.9rem;
		margin-bottom: 0.55rem;
	}

	.message-bubble header span,
	.tool-result-header strong {
		font-size: 0.74rem;
		font-weight: 650;
		letter-spacing: 0.01em;
		color: var(--ui-text-primary);
	}

	.message-bubble header small,
	.tool-result-header span,
	time {
		font-size: 0.66rem;
		color: var(--ui-text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.message-meta,
	.tool-result-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.message-usage,
	.tool-status {
		font-size: 0.66rem;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ui-text-secondary);
	}

	.tool-status.tone-success {
		color: color-mix(in oklab, var(--ui-success) 78%, var(--ui-text-primary));
	}

	.tool-status.tone-warning {
		color: color-mix(in oklab, var(--ui-warning) 82%, var(--ui-text-primary));
	}

	.tool-status.tone-danger {
		color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
	}

	.message-text {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 0.9rem;
		line-height: 1.64;
		color: var(--ui-text-primary);
	}

	.message-text + .message-text {
		margin-top: 0.72rem;
	}

	.thinking-block,
	.result-details {
		margin-top: 0.8rem;
		min-width: 0;
		padding: 0.78rem 0 0;
		border-radius: 0;
		border: none;
		border-top: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
		background: transparent;
	}

	.thinking-block summary,
	.result-details summary {
		cursor: pointer;
		font-size: 0.73rem;
		font-weight: 620;
		letter-spacing: 0.01em;
		color: var(--ui-text-secondary);
	}

	.thinking-block pre,
	.result-details pre {
		margin-top: 0.55rem;
		max-width: 100%;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
		font-size: 0.82rem;
		line-height: 1.6;
		color: var(--ui-text-secondary);
	}

	.tool-card {
		position: relative;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.8rem;
		margin-top: 0.8rem;
		padding: 0.75rem 0.85rem;
		border-radius: var(--ui-radius-md);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 84%, transparent);
		background: color-mix(in oklab, var(--ui-code) 94%, transparent);
		overflow: visible;
	}

	.tool-card::before,
	.tool-result::before {
		content: none;
	}

	.tool-card.error,
	.tool-result.error {
		background: color-mix(in oklab, var(--ui-danger-soft) 56%, transparent);
	}

	.tool-card.error,
	.tool-result.error {
		border-color: color-mix(in oklab, var(--ui-danger) 36%, var(--ui-border-soft));
	}

	.tool-result.error {
		border-color: color-mix(in oklab, var(--ui-danger) 42%, var(--ui-border-soft));
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
		font-size: 0.82rem;
		font-weight: 640;
		color: var(--ui-text-primary);
	}

	.tool-card-copy span {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--ui-text-secondary);
	}

	@media (max-width: 760px) {
		.chat-thread {
			padding-inline: 0.9rem;
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
