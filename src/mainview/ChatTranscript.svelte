<script lang="ts">
	import type { AssistantMessage, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
	import { onMount, tick } from "svelte";
	import { getArtifactCommandCopy, parseArtifactsParams } from "./artifacts";
	import { formatTimestamp, formatUsage } from "./chat-format";
	import { parseTranscriptMentionLinks } from "./composer-mentions";
	import type { ConversationProjection, ProjectedToolCall } from "./conversation-projection";
	import {
		summarizeExecuteTypescriptResult,
		type TranscriptSemanticBlock,
	} from "./transcript-projection";
	import {
		compensateTranscriptScrollForMeasuredRow,
		deriveTranscriptUserScrollState,
	} from "./transcript-scroll";
	import { TranscriptVirtualizer } from "./transcript-virtualizer";
	import EpisodeCard, { type ReferenceEpisode } from "./reference-cards/EpisodeCard.svelte";
	import FailedCard from "./reference-cards/FailedCard.svelte";
	import type { ReferenceStatus } from "./reference-cards/StatusBadge.svelte";
	import WaitingCard from "./reference-cards/WaitingCard.svelte";
	import WorkflowCard, { type ReferenceWorkflow } from "./reference-cards/WorkflowCard.svelte";
	import Button from "./ui/Button.svelte";

	const DEFAULT_TRANSCRIPT_ROW_GAP = 16;
	const MIN_VIRTUALIZED_MESSAGES = 40;

	type Props = {
		conversation: ConversationProjection;
		sessionId?: string;
		systemPrompt?: string;
		streamMessage?: AssistantMessage;
		pendingToolCalls: ReadonlySet<string>;
		isStreaming: boolean;
		workspaceMentionPaths?: ReadonlySet<string>;
		semanticBlocks?: TranscriptSemanticBlock[];
		onOpenArtifact: (filename: string) => void;
		onOpenWorkspacePath: (path: string) => void;
		onInspectCommand?: (commandId: string) => void;
		onReplyToWait?: (block: TranscriptSemanticBlock & { kind: "wait" }, text: string) => void;
		onRetryFailure?: (block: TranscriptSemanticBlock & { kind: "failure" }) => void;
		onScrollStateChange?: (scroll: { transcriptAnchorId: string | null; offsetPx: number }) => void;
	};

	let {
		conversation,
		sessionId,
		systemPrompt,
		streamMessage,
		pendingToolCalls,
		isStreaming,
		workspaceMentionPaths = new Set(),
		semanticBlocks = [],
		onOpenArtifact,
		onOpenWorkspacePath,
		onInspectCommand,
		onReplyToWait,
		onRetryFailure,
		onScrollStateChange,
	}: Props = $props();

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
	const resolvedSystemPrompt = $derived(systemPrompt?.trim() || null);
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

	function userLineSegments(line: string) {
		return parseTranscriptMentionLinks(line, workspaceMentionPaths);
	}

	function handleWorkspaceMentionClick(event: MouseEvent, path: string, missing?: boolean) {
		event.preventDefault();
		if (missing) return;
		onOpenWorkspacePath(path);
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

	function commandStatusLabel(status: string): string {
		if (status === "succeeded") return "Complete";
		if (status === "failed") return "Failed";
		if (status === "cancelled") return "Cancelled";
		if (status === "requested") return "Queued";
		return status[0]?.toUpperCase() + status.slice(1);
	}

	function commandReferenceStatus(status: string): ReferenceStatus {
		if (status === "succeeded") return "done";
		if (status === "failed" || status === "cancelled") return "failed";
		if (status === "waiting" || status === "requested") return "waiting";
		if (status === "running") return "running";
		return "idle";
	}

	function commandReferenceWorkflow(command: TranscriptSemanticBlock & { kind: "command-rollup" }): ReferenceWorkflow {
		const status = commandReferenceStatus(command.command.status);
		const stepsTotal = Math.max(
			1,
			command.command.summaryChildCount + command.command.traceChildCount,
		);
		return {
			id: command.command.commandId,
			name: command.command.title,
			status,
			elapsed: formatTimestamp(command.command.updatedAt),
			stepsDone: status === "done" ? stepsTotal : command.command.summaryChildCount,
			stepsTotal,
			currentStep: command.command.summary,
			runId: command.command.toolName,
		};
	}

	function episodeReference(block: TranscriptSemanticBlock & { kind: "handoff-episode" }): ReferenceEpisode {
		return {
			id: block.episode.episodeId,
			title: block.episode.title,
			summary: block.episode.summary,
			thread: block.thread.title,
			verified: block.episode.kind !== "clarification",
		};
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

	function executeTypescriptBody(toolName: string, argumentsValue: unknown): string | null {
		if (toolName !== "execute_typescript" || !argumentsValue || typeof argumentsValue !== "object") {
			return null;
		}
		const body = (argumentsValue as Record<string, unknown>).typescriptCode;
		return typeof body === "string" && body.length > 0 ? body : null;
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
		onScrollStateChange?.({
			transcriptAnchorId: conversation.visibleMessages[scrollState.anchorIndex]?.timestamp ?? null,
			offsetPx: scroller.scrollTop,
		});
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
		{#if resolvedSystemPrompt}
			<article class="message-row system-row">
				<div class="message-bubble assistant-bubble system-bubble">
					<details class="thinking-block system-prompt-block">
						<summary>Surface system prompt metadata</summary>
						<pre>{resolvedSystemPrompt}</pre>
					</details>
				</div>
			</article>
		{/if}

		{#if semanticBlocks.length > 0}
			<section class="transcript-semantic-stack" aria-label="Structured transcript projection">
				{#each semanticBlocks as block (block.key)}
					{#if block.kind === "wait"}
						<WaitingCard
							context={`${block.summary} · resume ${block.resumeWhen} · since ${formatTimestamp(block.since)}`}
							question={block.reason}
							onreply={(text) => onReplyToWait?.(block, text)}
						/>
					{:else if block.kind === "failure"}
						<FailedCard
							title={block.title}
							testsPassed={0}
							testsTotal={1}
							errorSnippet={block.summary}
							onretry={onRetryFailure ? () => onRetryFailure(block) : undefined}
						/>
					{:else if block.kind === "command-rollup"}
						<div class="reference-command-block">
							<WorkflowCard
								workflow={commandReferenceWorkflow(block)}
								onclick={() => onInspectCommand?.(block.command.commandId)}
							/>
							{#if block.command.summaryChildren.length > 0}
								<div class="reference-command-children" aria-label="Summary command details">
									{#each block.command.summaryChildren as child (child.commandId)}
										<div class="reference-command-child">
											<strong>{child.title}</strong>
											<span>{child.summary}</span>
										</div>
									{/each}
								</div>
							{/if}
							{#if onInspectCommand}
								<Button size="sm" variant="ghost" onclick={() => onInspectCommand?.(block.command.commandId)}>
									Inspect {commandStatusLabel(block.command.status)}
								</Button>
							{/if}
						</div>
					{:else if block.kind === "handoff-episode"}
						<EpisodeCard episode={episodeReference(block)} />
					{/if}
				{/each}
			</section>
		{/if}

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
							<p class="message-text">
								{#each userLineSegments(line) as segment, segmentIndex (`${message.timestamp}:line:${lineIndex}:segment:${segmentIndex}`)}
									{#if segment.type === "mention"}
										<a
											class={`workspace-mention-link ${segment.missing ? "missing" : ""}`.trim()}
											href={`workspace://${segment.path}`}
											title={segment.missing ? `Missing workspace path: ${segment.path}` : `Workspace path: ${segment.path}`}
											aria-disabled={segment.missing}
											onclick={(event) => handleWorkspaceMentionClick(event, segment.path ?? "", segment.missing)}
										>{segment.text}</a>
									{:else}
										{segment.text}
									{/if}
								{/each}
							</p>
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
								{@const toolBody = executeTypescriptBody(
									block.name,
									projectedToolCall?.argumentsValue ?? block.arguments,
								)}
								{@const status = toolStatus(block.id)}
								<div class={`relative flex flex-col gap-2.5 mt-3 p-3 rounded-md border border-border/80 bg-muted/40 shadow-sm overflow-visible transition-colors duration-200 ${status === 'error' ? 'bg-destructive/10 border-destructive/40' : ''}`.trim()}>
									<div class="flex items-start justify-between gap-3">
										<div class="flex flex-col gap-1 items-start">
											<strong>
												{params ? getArtifactCommandCopy(params.command).complete : `Ran ${block.name}`}
											</strong>
											{#if params}
												<span>{params.filename}</span>
											{:else}
												<span>{block.name}</span>
											{/if}
										</div>
										<div class="flex items-start gap-2 flex-wrap justify-end">
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
									{#if toolBody}
										<div class="flex flex-col gap-2 pt-3 mt-2 border-t border-border/60">
											<span class="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground">TypeScript body</span>
											<pre class="m-0 max-h-64 overflow-auto p-3 rounded-sm border border-border/60 bg-muted text-[12.5px] leading-relaxed text-foreground whitespace-pre-wrap break-words">{toolBody}</pre>
										</div>
									{/if}
								</div>
							{/if}
						{/each}
						</div>
					</article>
				{:else if message.role === "toolResult"}
					{@const projectedToolCall = conversation.toolCallsById.get(message.toolCallId)}
					{@const params = projectedToolCall?.artifactParams}
					{@const executeSummary = summarizeExecuteTypescriptResult(message)}
					<article
						class={`message-row ${shouldVirtualize ? "virtual-row " : ""}tool-row`.trim()}
						use:trackRowHeight={shouldVirtualize ? rowIndex : undefined}
						style={
							shouldVirtualize
								? `transform: translate3d(0, ${virtualizer.getOffsetForIndex(rowIndex)}px, 0);`
								: undefined
						}
					>
					<div class={`p-3 border border-border/80 bg-card rounded-md shadow-sm transition-colors duration-200 ${message.isError ? "bg-destructive/10 border-destructive/40" : ""}`.trim()}>
						<div class="flex items-start justify-between gap-3 mb-2">
							<div class="flex flex-col gap-1">
								<strong>
									{params ? getArtifactCommandCopy(params.command).complete : `Tool ${message.toolName}`}
								</strong>
								{#if params}
									<span>{params.filename}</span>
								{/if}
							</div>
							<div class="flex items-start gap-2 flex-wrap justify-end">
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
						{#if executeSummary}
							<div class="execute-result-grid">
								{#if executeSummary.error}
									<section class="execute-result-section error">
										<strong>
											{executeSummary.error.stage
												? `execute_typescript ${executeSummary.error.stage} error`
												: "execute_typescript error"}
										</strong>
										<pre>{executeSummary.error.message}</pre>
									</section>
								{/if}
								{#if executeSummary.diagnostics.length > 0}
									<section class="execute-result-section">
										<strong>Diagnostics</strong>
										{#each executeSummary.diagnostics as diagnostic, diagnosticIndex (`${message.toolCallId}:diagnostic:${diagnosticIndex}`)}
											<div class="diagnostic-row">
												<span>{diagnostic.severity ?? "diagnostic"}</span>
												<p>{diagnostic.message}</p>
												{#if diagnostic.file}
													<small>
														{diagnostic.file}{diagnostic.line ? `:${diagnostic.line}` : ""}{diagnostic.column ? `:${diagnostic.column}` : ""}
													</small>
												{/if}
											</div>
										{/each}
									</section>
								{/if}
								{#if executeSummary.logs.length > 0}
									<section class="execute-result-section">
										<strong>Logs</strong>
										<pre>{executeSummary.logs.join("\n")}</pre>
									</section>
								{/if}
								{#if executeSummary.resultPreview}
									<section class="execute-result-section">
										<strong>Return value</strong>
										<pre>{executeSummary.resultPreview}</pre>
									</section>
								{/if}
							</div>
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
							{@const toolBody = executeTypescriptBody(block.name, block.arguments)}
							<div class="relative flex flex-col gap-2.5 mt-3 p-3 rounded-md border border-border/80 bg-muted/40 shadow-sm overflow-visible transition-colors duration-200">
								<div class="flex items-start justify-between gap-3">
									<div class="flex flex-col gap-1 items-start">
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
								{#if toolBody}
									<div class="flex flex-col gap-2 pt-3 mt-2 border-t border-border/60">
										<span class="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground">TypeScript body</span>
										<pre class="m-0 max-h-64 overflow-auto p-3 rounded-sm border border-border/60 bg-muted text-[12.5px] leading-relaxed text-foreground whitespace-pre-wrap break-words">{toolBody}</pre>
									</div>
								{/if}
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
		width: min(100%, 45.5rem);
		margin: 0 auto;
		padding: 1rem 1.25rem 1.1rem;
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
	.tool-row,
	.system-row {
		justify-content: flex-start;
	}

	.message-bubble,
	.tool-result {
		position: relative;
		width: min(100%, 45.5rem);
		padding: 0;
		border-radius: var(--ui-radius-md);
		border: 0;
		background: transparent;
		box-shadow: none;
		overflow: visible;
	}

	.user-bubble {
		width: min(100%, 36rem);
		padding: 0.68rem 0.78rem;
		border: 1px solid var(--ui-border-soft);
		background: color-mix(in oklab, var(--ui-surface-subtle) 62%, transparent);
	}

	.assistant-bubble {
		background: transparent;
	}

	.tool-result {
		padding: 0.72rem 0.82rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
		background: var(--ui-surface);
		border-radius: var(--ui-radius-md);
		box-shadow: var(--ui-shadow-soft);
		transition: background-color 200ms ease, border-color 200ms ease;
	}

	.streaming {
		border-style: dashed;
	}

	.system-bubble {
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--ui-border-soft);
		background: color-mix(in oklab, var(--ui-surface-subtle) 54%, transparent);
	}

	.transcript-semantic-stack {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		width: min(100%, 45.5rem);
	}

	.reference-command-block {
		display: grid;
		gap: 0.4rem;
		justify-items: start;
	}

	.reference-command-children {
		display: grid;
		gap: 0.28rem;
		width: 100%;
		padding-inline: 0.2rem;
	}

	.reference-command-child {
		display: grid;
		gap: 0.12rem;
		padding-left: 0.62rem;
		border-left: 1px solid var(--ui-border-soft);
		color: var(--ui-text-tertiary);
		font-size: 0.64rem;
	}

	.reference-command-child strong {
		color: var(--ui-text-secondary);
		font-family: var(--font-mono);
		font-size: 0.58rem;
		font-weight: 650;
	}

	.message-bubble header,
	.tool-result-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.65rem;
		margin-bottom: 0.45rem;
	}

	.message-bubble header span,
	.tool-result-header strong {
		font-family: var(--font-mono);
		font-size: 0.56rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ui-text-tertiary);
	}

	.message-bubble header small,
	.tool-result-header span,
	time {
		font-family: var(--font-mono);
		font-size: 0.56rem;
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
		font-size: 0.81rem;
		line-height: 1.58;
		color: var(--ui-text-primary);
	}

	.message-text + .message-text {
		margin-top: 0.72rem;
	}

	.workspace-mention-link {
		display: inline;
		color: color-mix(in oklab, var(--ui-accent) 82%, var(--ui-text-primary));
		font-family: var(--font-mono);
		font-size: 0.86em;
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 0.18em;
	}

	.workspace-mention-link:hover,
	.workspace-mention-link:focus-visible {
		outline: none;
		color: var(--ui-text-primary);
		background: color-mix(in oklab, var(--ui-accent-soft) 72%, transparent);
	}

	.workspace-mention-link.missing {
		color: color-mix(in oklab, var(--ui-warning) 76%, var(--ui-text-primary));
		cursor: not-allowed;
		text-decoration-style: dashed;
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

	.system-prompt-block {
		margin-top: 0;
		padding-top: 0;
		border-top: none;
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

	.execute-result-grid {
		margin-top: 0.7rem;
		padding-top: 0.7rem;
		border-top: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
	}

	.execute-result-section {
		display: flex;
		flex-direction: column;
		gap: 0.38rem;
	}

	.execute-result-section strong {
		font-size: 0.7rem;
		font-weight: 650;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--ui-text-secondary);
	}

	.execute-result-section.error strong {
		color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
	}

	.execute-result-section pre {
		margin: 0;
		max-height: 12rem;
		overflow: auto;
		padding: 0.62rem 0.68rem;
		border-radius: var(--ui-radius-sm);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 78%, transparent);
		background: color-mix(in oklab, var(--ui-code) 90%, var(--ui-surface));
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--ui-text-primary);
	}

	.diagnostic-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.25rem 0.55rem;
		padding: 0.5rem 0.58rem;
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-danger-soft) 38%, transparent);
	}

	.diagnostic-row span {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
	}

	.diagnostic-row p,
	.diagnostic-row small {
		margin: 0;
		font-size: 0.74rem;
		line-height: 1.45;
		color: var(--ui-text-secondary);
	}

	.diagnostic-row small {
		grid-column: 2;
		font-family: var(--font-mono);
		color: var(--ui-text-tertiary);
	}

	@media (max-width: 760px) {
		.chat-thread {
			padding-inline: 0.9rem;
		}

		.message-bubble header,
		.tool-result-header {
			flex-direction: column;
			align-items: stretch;
		}

		.message-meta,
		.tool-result-actions {
			justify-content: flex-start;
		}
	}
</style>
