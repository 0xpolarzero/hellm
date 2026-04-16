<script lang="ts">
	import type { AssistantMessage, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
	import { onMount, tick } from "svelte";
	import { getArtifactCommandCopy, parseArtifactsParams } from "./artifacts";
	import { formatTimestamp, formatUsage } from "./chat-format";
	import type { ConversationProjection, ProjectedToolCall } from "./conversation-projection";
	import {
		compensateTranscriptScrollForMeasuredRow,
		deriveTranscriptUserScrollState,
	} from "./transcript-scroll";
	import { TranscriptVirtualizer } from "./transcript-virtualizer";
	import Button from "./ui/Button.svelte";

	const DEFAULT_TRANSCRIPT_ROW_GAP = 16;
	const MIN_VIRTUALIZED_MESSAGES = 40;

	type Props = {
		conversation: ConversationProjection;
		sessionId?: string;
		streamMessage?: AssistantMessage;
		pendingToolCalls: ReadonlySet<string>;
		isStreaming: boolean;
		onOpenArtifact: (filename: string) => void;
	};

	let { conversation, sessionId, streamMessage, pendingToolCalls, isStreaming, onOpenArtifact }: Props = $props();

	let scroller = $state<HTMLDivElement | null>(null);
	let thread = $state<HTMLDivElement | null>(null);
	let transcriptScrollTop = $state(0);
	let transcriptViewportHeight = $state(0);
	let transcriptRowGap = $state(DEFAULT_TRANSCRIPT_ROW_GAP);
	let transcriptStickToBottom = $state(true);
	let transcriptAnchorIndex = $state(0);
	let transcriptRevision = $state(0);
	let transcriptWindow = $state({
		startIndex: 0,
		endIndex: 0,
		totalHeight: 0,
	});
	let transcriptSessionId: string | undefined = undefined;
	let transcriptSessionInitialized = false;

	let autoScroll = $state(true);
	const virtualizer = new TranscriptVirtualizer({
		estimatedRowHeight: 132,
		rowGapPx: DEFAULT_TRANSCRIPT_ROW_GAP,
	});
	const shouldVirtualize = $derived(
		conversation.visibleMessages.length >= MIN_VIRTUALIZED_MESSAGES,
	);
	const windowedMessages = $derived(
		shouldVirtualize
			? conversation.visibleMessages.slice(
					transcriptWindow.startIndex,
					transcriptWindow.endIndex,
				)
			: conversation.visibleMessages,
	);
	const streamingAssistant = $derived(streamMessage ?? null);

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
		return conversation.artifactResultTextById.get(message.toolCallId) || toolResultText(message);
	}

	function toolStatus(toolCallId: string): "pending" | "error" | "done" {
		const result = conversation.toolResultsById.get(toolCallId);
		if (result?.isError) return "error";
		if (result) return "done";
		return "pending";
	}

	function toolAttemptLabel(toolCall: ProjectedToolCall | undefined): string | null {
		if (!toolCall || toolCall.totalAttempts <= 1) return null;
		return `Attempt ${toolCall.attempt} of ${toolCall.totalAttempts}`;
	}

	function handleScroll() {
		if (!scroller) return;
		transcriptScrollTop = scroller.scrollTop;
		const scrollState = deriveTranscriptUserScrollState({
			scrollTop: scroller.scrollTop,
			scrollHeight: scroller.scrollHeight,
			clientHeight: scroller.clientHeight,
			shouldVirtualize,
			currentAnchorIndex: transcriptAnchorIndex,
			getIndexAtOffset: (offset) => virtualizer.getIndexAtOffset(offset),
		});
		transcriptStickToBottom = scrollState.stickToBottom;
		autoScroll = scrollState.autoScroll;
		transcriptAnchorIndex = scrollState.anchorIndex;
	}

	function syncViewportMetrics() {
		if (!scroller) return;
		transcriptViewportHeight = scroller.clientHeight;
		if (thread) {
			const rowGap = parseFloat(getComputedStyle(thread).rowGap || "16");
			if (Number.isFinite(rowGap) && rowGap > 0) {
				transcriptRowGap = rowGap;
			}
		}
	}

	function updateWindowState() {
		if (!shouldVirtualize) {
			transcriptWindow = {
				startIndex: 0,
				endIndex: conversation.visibleMessages.length,
				totalHeight: 0,
			};
			return;
		}

		virtualizer.setRowGap(transcriptRowGap);
		virtualizer.setItemCount(conversation.visibleMessages.length);
		transcriptWindow = virtualizer.getWindow(transcriptScrollTop, transcriptViewportHeight);
	}

	function recordRowHeight(index: number, height: number) {
		if (!shouldVirtualize) return;

		const delta = virtualizer.recordHeight(index, height);
		if (!delta) return;

		transcriptRevision += 1;
		if (!scroller || transcriptStickToBottom) return;
		const compensatedScrollTop = compensateTranscriptScrollForMeasuredRow({
			scrollTop: scroller.scrollTop,
			delta,
			index,
			anchorIndex: transcriptAnchorIndex,
			stickToBottom: transcriptStickToBottom,
		});
		if (compensatedScrollTop !== null) {
			// Keep the last user-selected anchor stable while rows above it settle.
			scroller.scrollTop = compensatedScrollTop;
			transcriptScrollTop = compensatedScrollTop;
		}
	}

	function trackRowHeight(node: HTMLElement, index: number | undefined) {
		if (typeof index !== "number") {
			return {
				destroy() {},
			};
		}

		const measure = () => recordRowHeight(index, node.getBoundingClientRect().height);

		if (typeof ResizeObserver === "undefined") {
			measure();
			return {
				destroy() {},
			};
		}

		const observer = new ResizeObserver(measure);
		observer.observe(node);
		measure();

		return {
			destroy() {
				observer.disconnect();
			},
		};
	}

	onMount(() => {
		syncViewportMetrics();

		const observer = new ResizeObserver(() => {
			syncViewportMetrics();
		});

		if (scroller) observer.observe(scroller);
		if (thread) observer.observe(thread);

		return () => {
			observer.disconnect();
		};
	});

	$effect(() => {
		void sessionId;

		if (transcriptSessionInitialized && sessionId === transcriptSessionId) return;
		transcriptSessionInitialized = true;
		transcriptSessionId = sessionId;
		virtualizer.reset();
		virtualizer.setRowGap(transcriptRowGap);
		virtualizer.setItemCount(conversation.visibleMessages.length);
		transcriptScrollTop = 0;
		transcriptAnchorIndex = 0;
		transcriptStickToBottom = true;
		autoScroll = true;
		transcriptWindow = virtualizer.getWindow(0, transcriptViewportHeight);
	}
	);

	$effect(() => {
		void conversation.visibleMessages.length;
		void shouldVirtualize;
		void transcriptViewportHeight;
		void transcriptRowGap;
		void transcriptScrollTop;
		void transcriptRevision;

		updateWindowState();
	}
	);

	$effect(() => {
		void conversation.visibleMessages.length;
		void conversation.toolResultsById;
		void streamingAssistant;
		void pendingToolCalls;
		void isStreaming;

		if (!scroller || !autoScroll) return;
		void tick().then(() => {
			if (!scroller) return;
			scroller.scrollTop = scroller.scrollHeight;
			transcriptScrollTop = scroller.scrollTop;
		});
	});
</script>

<div bind:this={scroller} class="chat-transcript" onscroll={handleScroll}>
	<div bind:this={thread} class="chat-thread">
		<div
			class:chat-thread-virtual={shouldVirtualize}
			style={shouldVirtualize ? `height: ${transcriptWindow.totalHeight}px;` : undefined}
		>
			{#each windowedMessages as message, index (`${message.role}:${message.timestamp}:${transcriptWindow.startIndex + index}`)}
				{@const rowIndex = shouldVirtualize ? transcriptWindow.startIndex + index : index}
				{#if message.role === "user"}
					<article
						class={`message-row ${shouldVirtualize ? "virtual-row " : ""}user-row`.trim()}
						use:trackRowHeight={shouldVirtualize ? rowIndex : undefined}
						style={
							shouldVirtualize
								? `transform: translate3d(0, ${virtualizer.getOffsetForIndex(rowIndex)}px, 0);`
								: undefined
						}
					>
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
					<article
						class={`message-row ${shouldVirtualize ? "virtual-row " : ""}assistant-row`.trim()}
						use:trackRowHeight={shouldVirtualize ? rowIndex : undefined}
						style={
							shouldVirtualize
								? `transform: translate3d(0, ${virtualizer.getOffsetForIndex(rowIndex)}px, 0);`
								: undefined
						}
					>
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
								{@const projectedToolCall = conversation.toolCallsById.get(block.id)}
								{@const params = projectedToolCall?.artifactParams ?? parseArtifactsParams(block.arguments)}
								{@const status = toolStatus(block.id)}
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
										{#if toolAttemptLabel(projectedToolCall)}
											<span class="tool-attempt">{toolAttemptLabel(projectedToolCall)}</span>
										{/if}
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
					{@const projectedToolCall = conversation.toolCallsById.get(message.toolCallId)}
					{@const params = projectedToolCall?.artifactParams}
					<article
						class={`message-row ${shouldVirtualize ? "virtual-row " : ""}tool-row`.trim()}
						use:trackRowHeight={shouldVirtualize ? rowIndex : undefined}
						style={
							shouldVirtualize
								? `transform: translate3d(0, ${virtualizer.getOffsetForIndex(rowIndex)}px, 0);`
								: undefined
						}
					>
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
								{#if toolAttemptLabel(projectedToolCall)}
									<span class="tool-attempt">{toolAttemptLabel(projectedToolCall)}</span>
								{/if}
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
		</div>

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

	.chat-thread-virtual {
		position: relative;
		width: 100%;
		contain: layout paint size;
	}

	.message-row {
		display: flex;
		width: 100%;
	}

	.virtual-row {
		position: absolute;
		inset-inline: 0;
		will-change: transform;
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

	.tool-attempt {
		font-size: 0.66rem;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ui-text-secondary);
		opacity: 0.9;
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
