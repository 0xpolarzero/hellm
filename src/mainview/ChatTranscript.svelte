<script lang="ts">
	import { getModels, type AssistantMessage, type Model, type ToolResultMessage, type UserMessage } from "@mariozechner/pi-ai";
	import CheckIcon from "@lucide/svelte/icons/check";
	import ClockIcon from "@lucide/svelte/icons/clock";
	import CopyIcon from "@lucide/svelte/icons/copy";
	import FileIcon from "@lucide/svelte/icons/file";
	import FolderIcon from "@lucide/svelte/icons/folder";
	import GitForkIcon from "@lucide/svelte/icons/git-fork";
	import ImageIcon from "@lucide/svelte/icons/image";
	import PencilIcon from "@lucide/svelte/icons/pencil";
	import { createVirtualizer } from "@tanstack/svelte-virtual";
	import { onDestroy, onMount, tick } from "svelte";
	import { get } from "svelte/store";
	import { parseArtifactsParams } from "./artifacts";
	import { formatCost, formatTimestamp } from "./chat-format";
	import { buildContextBudgetFromUsage, type ContextBudget } from "./context-budget";
	import { parseTranscriptMentionLinks } from "./composer-mentions";
	import type { ConversationProjection, ProjectedToolCall } from "./conversation-projection";
	import {
		summarizeExecuteTypescriptResult,
		type TranscriptSemanticBlock,
	} from "./transcript-projection";
	import {
		TRANSCRIPT_SCROLL_TO_BOTTOM_DURATION_MS,
		TRANSCRIPT_STICK_TO_BOTTOM_THRESHOLD_PX,
		deriveTranscriptScrollTopForViewportResize,
		deriveTranscriptUserScrollState,
		easeTranscriptScrollToBottom,
		getTranscriptDistanceFromBottom,
		shouldAdjustTranscriptScrollForMeasuredItem,
	} from "./transcript-scroll";
	import AssistantMarkdown from "./AssistantMarkdown.svelte";
	import ContextBudgetBar from "./ContextBudgetBar.svelte";
	import EpisodeCard, { type TranscriptEpisode } from "./transcript-cards/EpisodeCard.svelte";
	import FailedCard from "./transcript-cards/FailedCard.svelte";
	import type { TranscriptStatus } from "./transcript-cards/StatusBadge.svelte";
	import ThreadCard, { type TranscriptThread } from "./transcript-cards/ThreadCard.svelte";
	import ToolCallCard from "./transcript-cards/ToolCallCard.svelte";
	import WaitingCard from "./transcript-cards/WaitingCard.svelte";
	import WorkflowCard, { type TranscriptWorkflow } from "./transcript-cards/WorkflowCard.svelte";
	import {
		parseComposerAttachmentTextSignature,
		type ComposerAttachment,
		type ConversationTurnTiming,
		type PromptTarget,
		type WorkspaceHandlerThreadSummary,
	} from "../shared/workspace-contract";
	import { rpc } from "./rpc";
	import Button from "./ui/Button.svelte";
	import Tooltip from "./ui/Tooltip.svelte";
	import { formatTurnDuration, formatTurnDurationTooltip } from "./working-timer";

	const DEFAULT_TRANSCRIPT_ROW_GAP = 16;

	type Props = {
		conversation: ConversationProjection;
		target?: PromptTarget | null;
		sessionId?: string;
		systemPrompt?: string;
		streamMessage?: AssistantMessage;
		currentModel?: Model<any> | null;
		pendingToolCalls: ReadonlySet<string>;
		isStreaming: boolean;
		turnTimings: ConversationTurnTiming[];
		workspaceMentionPaths?: ReadonlySet<string>;
		semanticBlocks?: TranscriptSemanticBlock[];
		onOpenArtifact: (filename: string) => void;
		onOpenWorkspacePath: (path: string) => void;
		onInspectCommand?: (commandId: string) => void;
		onOpenHandlerThread?: (threadId: string) => void;
		onInspectWorkflow?: (workflowId: string) => void;
		onInspectWorkflowTaskAttempt?: (workflowTaskAttemptId: string) => void;
		onForkAssistantMessage?: (message: AssistantMessage) => void;
		onEditUserMessage?: (message: UserMessage, text: string) => void;
		onReplyToWait?: (block: TranscriptSemanticBlock & { kind: "wait" }, text: string) => void;
		onRetryFailure?: (block: TranscriptSemanticBlock & { kind: "failure" }) => void;
		initialScroll?: { transcriptAnchorId: string | null; offsetPx: number } | null;
		editingUserMessageTimestamp?: string | number | null;
		onScrollStateChange?: (scroll: { transcriptAnchorId: string | null; offsetPx: number }) => void;
	};

	let {
		conversation,
		target = null,
		sessionId,
		systemPrompt,
		streamMessage,
		currentModel = null,
		pendingToolCalls,
		isStreaming,
		turnTimings,
		workspaceMentionPaths = new Set(),
		semanticBlocks = [],
		onOpenArtifact,
		onOpenWorkspacePath,
		onInspectCommand,
		onOpenHandlerThread,
		onInspectWorkflow,
		onInspectWorkflowTaskAttempt,
		onForkAssistantMessage,
		onEditUserMessage,
		onReplyToWait,
		onRetryFailure,
		initialScroll,
		editingUserMessageTimestamp = null,
		onScrollStateChange,
	}: Props = $props();

	let scroller = $state<HTMLDivElement | null>(null);
	let threadElement = $state<HTMLDivElement | null>(null);
	let transcriptScrollTop = $state(0);
	let transcriptViewportHeight = $state(0);
	let transcriptRowGap = $state(DEFAULT_TRANSCRIPT_ROW_GAP);
	let transcriptStickToBottom = $state(true);
	let transcriptAnchorIndex = $state(0);
	let copiedAssistantMessageTimestamp = $state<string | null>(null);
	let copiedUserMessageTimestamp = $state<string | null>(null);
	let transcriptSessionId: string | undefined = undefined;
	let transcriptSessionInitialized = false;
	let restoredInitialScrollForSession: string | undefined = undefined;
	let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
	let programmaticScrollFrame: number | null = null;
	let programmaticScrollActive = false;

	let autoScroll = $state(true);
	const resolvedSystemPrompt = $derived(systemPrompt?.trim() || null);
	const streamingAssistant = $derived(streamMessage ?? null);
	const turnTimingByAssistantTimestamp = $derived.by(() => {
		const timings = new Map<string, ConversationTurnTiming>();
		for (const timing of turnTimings) {
			timings.set(String(timing.assistantMessageTimestamp), timing);
		}
		return timings;
	});
	type AssistantContentBlock = AssistantMessage["content"][number];
	function thinkingDisplayText(block: Extract<AssistantContentBlock, { type: "thinking" }>): string {
		if (block.thinking.trim()) return block.thinking;
		if (block.redacted) return "[redacted]";
		if (block.thinkingSignature) return "Reasoning summary unavailable";
		return "(empty)";
	}

	type TranscriptRow =
		| { kind: "system"; key: string; systemPrompt: string }
		| { kind: "semantic"; key: string; block: TranscriptSemanticBlock }
		| { kind: "message"; key: string; message: UserMessage | AssistantMessage | ToolResultMessage };
	const transcriptRows = $derived.by<TranscriptRow[]>(() => {
		const rows: TranscriptRow[] = [];
		if (resolvedSystemPrompt) {
			rows.push({ kind: "system", key: "system-prompt", systemPrompt: resolvedSystemPrompt });
		}
		for (const block of semanticBlocks) {
			rows.push({ kind: "semantic", key: `semantic:${block.key}`, block });
		}
		for (const message of conversation.visibleMessages) {
			rows.push({ kind: "message", key: `${message.role}:${message.timestamp}`, message });
		}
		return rows;
	});
	const shouldVirtualize = true;
	const transcriptVirtualizer = createVirtualizer<HTMLDivElement, HTMLElement>({
		count: 0,
		getScrollElement: () => scroller,
		estimateSize: (index) => estimateTranscriptRowSize(transcriptRows[index]),
		getItemKey: (index) => transcriptRows[index]?.key ?? index,
		overscan: 10,
		gap: DEFAULT_TRANSCRIPT_ROW_GAP,
		enabled: true,
		shouldAdjustScrollPositionOnItemSizeChange: (item) =>
			shouldAdjustTranscriptScrollForMeasuredItem({
				index: item.index,
				anchorIndex: transcriptAnchorIndex,
				stickToBottom: transcriptStickToBottom,
			}),
	});
	const virtualRows = $derived($transcriptVirtualizer.getVirtualItems());
	const totalTranscriptSize = $derived($transcriptVirtualizer.getTotalSize());
	const estimatedTranscriptSize = $derived.by(() => {
		if (transcriptRows.length === 0) return 0;
		const estimatedRowsHeight = transcriptRows.reduce(
			(total, row) => total + estimateTranscriptRowSize(row),
			0,
		);
		return estimatedRowsHeight + Math.max(0, transcriptRows.length - 1) * transcriptRowGap;
	});
	const transcriptVirtualHeight = $derived(
		totalTranscriptSize > 0 ? totalTranscriptSize : estimatedTranscriptSize,
	);

	function estimateTranscriptRowSize(row: TranscriptRow | undefined): number {
		if (!row) return 132;
		if (row.kind === "system") return 92;
		if (row.kind === "semantic") return 156;
		if (row.message.role === "user") return 96;
		if (row.message.role === "toolResult") return 148;
		return 172;
	}

	function userTextLines(message: UserMessage): string[] {
		if (typeof message.content === "string") return [message.content];
		return message.content
			.filter(
				(block): block is { type: "text"; text: string; textSignature?: string } =>
					block.type === "text" && parseComposerAttachmentTextSignature(block.textSignature).length === 0,
			)
			.map((block) => block.text);
	}

	function userDraftText(message: UserMessage): string {
		return userTextLines(message).join("\n\n").trim();
	}

	function isEditingUserMessage(message: UserMessage): boolean {
		return (
			editingUserMessageTimestamp !== null &&
			String(message.timestamp) === String(editingUserMessageTimestamp)
		);
	}

	function assistantTurnTiming(message: AssistantMessage): ConversationTurnTiming | null {
		return turnTimingByAssistantTimestamp.get(String(message.timestamp)) ?? null;
	}

	function userImageBlocks(message: UserMessage) {
		if (typeof message.content === "string") return [];
		return message.content.filter((block) => block.type === "image");
	}

	function userAttachments(message: UserMessage): ComposerAttachment[] {
		if (typeof message.content === "string") return [];
		return message.content.flatMap((block) =>
			block.type === "text" ? parseComposerAttachmentTextSignature(block.textSignature) : [],
		);
	}

	function userImageAttachments(message: UserMessage): Array<{ attachment: ComposerAttachment; imageData: string | null }> {
		const images = userImageBlocks(message);
		return userAttachments(message)
			.filter((attachment) => attachment.kind === "image")
			.map((attachment, index) => {
				const image = images[index];
				return {
					attachment,
					imageData: image ? `data:${image.mimeType};base64,${image.data}` : null,
				};
			});
	}

	function userFileAttachments(message: UserMessage): ComposerAttachment[] {
		return userAttachments(message).filter((attachment) => attachment.kind !== "image");
	}

	function userAttachmentCaption(attachment: ComposerAttachment): string {
		return attachment.workspaceRelativePath ?? attachment.path;
	}

	function isHandlerObjectiveMessage(message: UserMessage): boolean {
		if (target?.surface !== "thread") return false;
		const firstUserMessage = conversation.visibleMessages.find(
			(candidate): candidate is UserMessage => candidate.role === "user",
		);
		return firstUserMessage === message;
	}

	function userLineSegments(line: string) {
		return parseTranscriptMentionLinks(line, workspaceMentionPaths);
	}

	function assistantMessageText(message: AssistantMessage): string {
		return message.content
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("\n\n")
			.trim();
	}

	function exactTokenCount(count: number): string {
		return count.toLocaleString("en-US");
	}

	function knownModelContextWindow(message: AssistantMessage): number | null {
		if (currentModel?.provider === message.provider && currentModel.id === message.model) {
			return currentModel.contextWindow;
		}
		try {
			return getModels(message.provider).find((model) => model.id === message.model)?.contextWindow ?? null;
		} catch {
			return null;
		}
	}

	function assistantMessageContextBudget(message: AssistantMessage): ContextBudget | null {
		return buildContextBudgetFromUsage(message.usage, knownModelContextWindow(message));
	}

	function assistantMessageContextTooltipDetails(message: AssistantMessage, budget: ContextBudget) {
		const rows = [
			{ label: "Context", value: `${exactTokenCount(budget.usedTokens)} tok` },
			{ label: "Input", value: `${exactTokenCount(message.usage.input)} tok` },
			message.usage.cacheRead
				? { label: "Cache read", value: `${exactTokenCount(message.usage.cacheRead)} tok` }
				: null,
			{ label: "Output", value: `${exactTokenCount(message.usage.output)} tok` },
			message.usage.cacheWrite
				? { label: "Cache write", value: `${exactTokenCount(message.usage.cacheWrite)} tok` }
				: null,
			message.usage.cost?.total ? { label: "Cost", value: formatCost(message.usage.cost.total) } : null,
		];
		return rows.filter((row): row is { label: string; value: string } => row !== null);
	}

	async function copyTextToClipboard(text: string): Promise<void> {
		try {
			await rpc.request.writeClipboardText({ text });
			return;
		} catch (rpcError) {
			if (navigator.clipboard?.writeText) {
				try {
					await navigator.clipboard.writeText(text);
					return;
				} catch (clipboardError) {
					throw new Error("Native and browser clipboard writes failed.", {
						cause: clipboardError,
					});
				}
			}

			if (!document.queryCommandSupported?.("copy")) {
				throw rpcError;
			}
		}

		const fallback = document.createElement("textarea");
		fallback.value = text;
		fallback.setAttribute("readonly", "true");
		fallback.style.position = "fixed";
		fallback.style.top = "0";
		fallback.style.left = "0";
		fallback.style.opacity = "0";
		document.body.appendChild(fallback);
		fallback.focus();
		fallback.select();

		try {
			const copied = document.execCommand("copy");
			if (!copied) {
				throw new Error("Document copy command was rejected.");
			}
		} finally {
			document.body.removeChild(fallback);
		}
	}

	async function handleCopyAssistantMessage(message: AssistantMessage) {
		const text = assistantMessageText(message);
		if (!text) return;
		if (copyResetTimer) {
			clearTimeout(copyResetTimer);
		}
		await copyTextToClipboard(text);
		copiedUserMessageTimestamp = null;
		copiedAssistantMessageTimestamp = message.timestamp;
		copyResetTimer = window.setTimeout(() => {
			copiedAssistantMessageTimestamp = null;
			copyResetTimer = null;
		}, 1800);
	}

	async function handleCopyUserMessage(message: UserMessage) {
		const text = userDraftText(message);
		if (!text) return;
		if (copyResetTimer) {
			clearTimeout(copyResetTimer);
		}
		await copyTextToClipboard(text);
		copiedAssistantMessageTimestamp = null;
		copiedUserMessageTimestamp = String(message.timestamp);
		copyResetTimer = window.setTimeout(() => {
			copiedUserMessageTimestamp = null;
			copyResetTimer = null;
		}, 1800);
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

	function commandTranscriptStatus(status: string): TranscriptStatus {
		if (status === "succeeded" || status === "completed" || status === "passed") return "done";
		if (status === "failed" || status === "cancelled") return "failed";
		if (status === "blocked" || status === "troubleshooting") return "blocked";
		if (status === "waiting" || status === "requested") return "waiting";
		if (status === "running" || status === "running-handler" || status === "running-workflow" || status === "continued") return "running";
		return "idle";
	}

	function workflowTranscript(run: any): TranscriptWorkflow {
		const stepsDone = run.stepsDone ?? 0;
		const stepsTotal = Math.max(1, run.stepsTotal ?? 1);
		return {
			id: run.workflowRunId,
			name: run.workflowName ?? run.title ?? run.workflowRunId,
			status: commandTranscriptStatus(run.status),
			elapsed: formatTimestamp(run.updatedAt),
			stepsDone,
			stepsTotal,
			currentStep: run.summary ?? (run.status === "running" ? "Running" : "Completed"),
			runId: run.workflowRunId,
		};
	}

	function commandRollupTranscript(command: TranscriptSemanticBlock & { kind: "command-rollup" }): TranscriptWorkflow {
		const status = commandTranscriptStatus(command.command.status);
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

	function episodeTranscript(block: TranscriptSemanticBlock & { kind: "handoff-episode" }): TranscriptEpisode {
		return {
			id: block.episode.episodeId,
			title: block.episode.title,
			summary: block.episode.summary,
			thread: block.thread.title,
			verified: block.episode.kind !== "clarification",
		};
	}

	function threadTranscript(handlerThread: WorkspaceHandlerThreadSummary): TranscriptThread {
		return {
			id: handlerThread.threadId,
			title: handlerThread.title,
			objective: handlerThread.latestEpisode?.summary || handlerThread.objective,
			status: commandTranscriptStatus(handlerThread.status),
			elapsed: formatTimestamp(handlerThread.updatedAt),
			model: "handler-thread",
			latestWorkflowRun: handlerThread.latestWorkflowRun ? workflowTranscript(handlerThread.latestWorkflowRun) : undefined,
		};
	}

	function subagentTranscripts(handlerThread: WorkspaceHandlerThreadSummary) {
		return (handlerThread.workflowTaskAttempts ?? []).map((attempt) => ({
			id: attempt.workflowTaskAttemptId,
			type: "workflow-task-agent" as const,
			headline: attempt.title,
			status: commandTranscriptStatus(attempt.status),
			model: attempt.model,
		}));
	}

	function toolStatus(toolCallId: string): "pending" | "error" | "done" {
		const result = conversation.toolResultsById.get(toolCallId);
		if (result?.isError) return "error";
		if (result) return "done";
		return "pending";
	}

	function executeTypescriptBody(toolName: string, argumentsValue: unknown): string | null {
		if (toolName !== "execute_typescript" || !argumentsValue || typeof argumentsValue !== "object") {
			return null;
		}
		const body = (argumentsValue as Record<string, unknown>).typescriptCode;
		return typeof body === "string" && body.length > 0 ? body : null;
	}

	function toolInputBody(toolName: string, argumentsValue: unknown): string | null {
		const executeBody = executeTypescriptBody(toolName, argumentsValue);
		if (executeBody) return executeBody;
		if (typeof argumentsValue === "undefined" || argumentsValue === null || argumentsValue === "") return null;
		if (typeof argumentsValue === "string") return argumentsValue;
		try {
			return JSON.stringify(argumentsValue, null, 2);
		} catch {
			return String(argumentsValue);
		}
	}

	function toolResultPreview(message: ToolResultMessage | undefined): string | null {
		if (!message) return null;
		const executeSummary = summarizeExecuteTypescriptResult(message);
		if (executeSummary) {
			const lines: string[] = [];
			if (executeSummary.resultPreview) lines.push(executeSummary.resultPreview);
			if (executeSummary.error?.message) lines.push(executeSummary.error.message);
			for (const diagnostic of executeSummary.diagnostics.slice(0, 6)) {
				lines.push(`${diagnostic.severity ?? "diagnostic"}: ${diagnostic.message}`);
			}
			for (const log of executeSummary.logs.slice(0, 8)) {
				lines.push(log);
			}
			return lines.join("\n").trim() || null;
		}
		return resultDetailsText(message) || null;
	}

	function prefersReducedMotion(): boolean {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	}

	function currentDistanceFromBottom(): number {
		if (!scroller) return 0;
		return getTranscriptDistanceFromBottom({
			scrollTop: scroller.scrollTop,
			scrollHeight: scroller.scrollHeight,
			clientHeight: scroller.clientHeight,
		});
	}

	function persistCurrentScrollState(anchorIndex = transcriptAnchorIndex) {
		if (!scroller) return;
		onScrollStateChange?.({
			transcriptAnchorId: transcriptRows[anchorIndex]?.key ?? null,
			offsetPx: scroller.scrollTop,
		});
	}

	function cancelProgrammaticScroll() {
		if (programmaticScrollFrame !== null) {
			cancelAnimationFrame(programmaticScrollFrame);
			programmaticScrollFrame = null;
		}
		programmaticScrollActive = false;
	}

	function handleUserScrollIntent() {
		cancelProgrammaticScroll();
	}

	function syncTranscriptScrollStateFromScroller() {
		if (!scroller) return;
		transcriptScrollTop = scroller.scrollTop;
		const scrollState = deriveTranscriptUserScrollState({
			scrollTop: scroller.scrollTop,
			scrollHeight: scroller.scrollHeight,
			clientHeight: scroller.clientHeight,
			shouldVirtualize,
			currentAnchorIndex: transcriptAnchorIndex,
			getIndexAtOffset: (offset) => $transcriptVirtualizer.getVirtualItemForOffset(offset)?.index ?? 0,
		});
		transcriptStickToBottom = scrollState.stickToBottom;
		autoScroll = scrollState.autoScroll;
		transcriptAnchorIndex = scrollState.anchorIndex;
		persistCurrentScrollState(scrollState.anchorIndex);
	}

	function scrollTranscriptToBottom(options: { animated?: boolean } = {}) {
		if (!scroller) return;
		const { animated = true } = options;
		if (programmaticScrollActive) return;

		const startScrollTop = scroller.scrollTop;
		const initialDistance = currentDistanceFromBottom();
		const shouldAnimate =
			animated &&
			!prefersReducedMotion() &&
			initialDistance > TRANSCRIPT_STICK_TO_BOTTOM_THRESHOLD_PX;

		transcriptStickToBottom = true;
		autoScroll = true;

		if (!shouldAnimate) {
			scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
			transcriptScrollTop = scroller.scrollTop;
			persistCurrentScrollState();
			return;
		}

		programmaticScrollActive = true;
		const startedAt = performance.now();
		const step = (now: number) => {
			if (!scroller) {
				programmaticScrollActive = false;
				programmaticScrollFrame = null;
				return;
			}

			const progress = Math.min(1, (now - startedAt) / TRANSCRIPT_SCROLL_TO_BOTTOM_DURATION_MS);
			const targetScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
			const nextScrollTop =
				startScrollTop + (targetScrollTop - startScrollTop) * easeTranscriptScrollToBottom(progress);
			scroller.scrollTop = nextScrollTop;
			transcriptScrollTop = scroller.scrollTop;

			if (
				progress < 1 &&
				currentDistanceFromBottom() > TRANSCRIPT_STICK_TO_BOTTOM_THRESHOLD_PX
			) {
				programmaticScrollFrame = requestAnimationFrame(step);
				return;
			}

			scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
			transcriptScrollTop = scroller.scrollTop;
			transcriptStickToBottom = true;
			autoScroll = true;
			programmaticScrollActive = false;
			programmaticScrollFrame = null;
			persistCurrentScrollState();
		};
		programmaticScrollFrame = requestAnimationFrame(step);
	}

	function handleScroll() {
		if (!scroller) return;
		if (programmaticScrollActive) {
			transcriptScrollTop = scroller.scrollTop;
			return;
		}
		syncTranscriptScrollStateFromScroller();
	}

	function syncViewportMetrics() {
		if (!scroller) return;
		const previousViewportHeight = transcriptViewportHeight;
		const nextViewportHeight = scroller.clientHeight;
		const resizedScrollTop = deriveTranscriptScrollTopForViewportResize({
			scrollTop: scroller.scrollTop,
			previousClientHeight: previousViewportHeight,
			nextClientHeight: nextViewportHeight,
			stickToBottom: transcriptStickToBottom,
		});
		if (resizedScrollTop !== null && !programmaticScrollActive) {
			scroller.scrollTop = resizedScrollTop;
			syncTranscriptScrollStateFromScroller();
		}
		transcriptViewportHeight = nextViewportHeight;
		if (threadElement) {
			const rowGap = parseFloat(getComputedStyle(threadElement).rowGap || "16");
			if (Number.isFinite(rowGap) && rowGap > 0) {
				transcriptRowGap = rowGap;
			}
		}
		if (transcriptStickToBottom && autoScroll) {
			scrollTranscriptToBottom({ animated: false });
		}
	}

	function measureTranscriptRow(node: HTMLElement) {
		$transcriptVirtualizer.measureElement(node);
		return {
			update() {
				$transcriptVirtualizer.measureElement(node);
			},
			destroy() {
				$transcriptVirtualizer.measureElement(null);
			}
		};
	}

	onMount(() => {
		syncViewportMetrics();

		const observer = new ResizeObserver(() => {
			syncViewportMetrics();
		});
		const scrollElement = scroller;
		const transcriptThreadElement = threadElement;
		const userScrollListenerOptions = { passive: true };

		if (scrollElement) observer.observe(scrollElement);
		if (transcriptThreadElement) observer.observe(transcriptThreadElement);
		scrollElement?.addEventListener("pointerdown", handleUserScrollIntent, userScrollListenerOptions);
		scrollElement?.addEventListener("wheel", handleUserScrollIntent, userScrollListenerOptions);

		return () => {
			observer.disconnect();
			scrollElement?.removeEventListener("pointerdown", handleUserScrollIntent);
			scrollElement?.removeEventListener("wheel", handleUserScrollIntent);
		};
	});

	onDestroy(() => {
		if (copyResetTimer) {
			clearTimeout(copyResetTimer);
			copyResetTimer = null;
		}
		cancelProgrammaticScroll();
	});

	$effect(() => {
		void sessionId;

		if (transcriptSessionInitialized && sessionId === transcriptSessionId) return;
		transcriptSessionInitialized = true;
		transcriptSessionId = sessionId;
		cancelProgrammaticScroll();
		transcriptScrollTop = 0;
		transcriptAnchorIndex = 0;
		transcriptStickToBottom = true;
		autoScroll = true;
	}
	);

	$effect(() => {
		void transcriptRows.length;
		void transcriptRows;
		void transcriptRowGap;
		void scroller;
		get(transcriptVirtualizer).setOptions({
			count: transcriptRows.length,
			getScrollElement: () => scroller,
			estimateSize: (index) => estimateTranscriptRowSize(transcriptRows[index]),
			getItemKey: (index) => transcriptRows[index]?.key ?? index,
			gap: transcriptRowGap,
			enabled: true,
		});
	}
	);

	$effect(() => {
		void initialScroll;
		void sessionId;
		void transcriptRows.length;
		if (!scroller || !initialScroll || restoredInitialScrollForSession === sessionId) return;
		restoredInitialScrollForSession = sessionId;
		cancelProgrammaticScroll();
		const anchorIndex = initialScroll.transcriptAnchorId
			? transcriptRows.findIndex((row) => row.key === initialScroll.transcriptAnchorId)
			: -1;
		if (anchorIndex >= 0) {
			get(transcriptVirtualizer).scrollToIndex(anchorIndex, { align: "start" });
		} else {
			scroller.scrollTop = Math.max(0, initialScroll.offsetPx);
		}
		syncTranscriptScrollStateFromScroller();
	});

	$effect(() => {
		void conversation.visibleMessages.length;
		void conversation.toolResultsById;
		void streamingAssistant;
		void pendingToolCalls;
		void isStreaming;

		if (!scroller || !autoScroll) return;
		void tick().then(() => {
			if (!scroller) return;
			scrollTranscriptToBottom({ animated: true });
		});
	});
</script>

<div
	bind:this={scroller}
	class="chat-transcript"
	onscroll={handleScroll}
>
	<div bind:this={threadElement} class="chat-thread">
		<div class="chat-thread-virtual" style={`height: ${transcriptVirtualHeight}px;`}>
			{#each virtualRows as virtualRow (virtualRow.key)}
				{@const row = transcriptRows[virtualRow.index]}
				{#if row?.kind === "system"}
					<article
						data-index={virtualRow.index}
						use:measureTranscriptRow
						class="message-row virtual-row system-row"
						style={`transform: translate3d(0, ${virtualRow.start}px, 0);`}
					>
						<div class="message-bubble assistant-bubble system-bubble">
							<details class="thinking-block system-prompt-block">
								<summary>{target?.surface === "thread" ? "Handler system prompt" : "Surface system prompt metadata"}</summary>
								<pre>{row.systemPrompt}</pre>
							</details>
						</div>
					</article>
				{:else if row?.kind === "semantic"}
					<section
						data-index={virtualRow.index}
						use:measureTranscriptRow
						class="transcript-semantic-stack virtual-row"
						style={`transform: translate3d(0, ${virtualRow.start}px, 0);`}
						aria-label="Structured transcript projection"
					>
						{#if row.block.kind === "wait"}
							<WaitingCard
								context={`${row.block.summary} · resume ${row.block.resumeWhen} · since ${formatTimestamp(row.block.since)}`}
								question={row.block.reason}
								onreply={(text) => row.block.kind === "wait" && onReplyToWait?.(row.block, text)}
							/>
						{:else if row.block.kind === "failure"}
							<FailedCard
								title={row.block.title}
								testsPassed={0}
								testsTotal={1}
								errorSnippet={row.block.summary}
								onretry={onRetryFailure ? () => row.block.kind === "failure" && onRetryFailure(row.block) : undefined}
							/>
						{:else if row.block.kind === "command-rollup"}
							<div class="reference-command-block">
								<WorkflowCard
									workflow={commandRollupTranscript(row.block)}
									onclick={() => row.block.kind === "command-rollup" && onInspectCommand?.(row.block.command.commandId)}
								/>
								{#if row.block.command.summaryChildren.length > 0}
									<div class="reference-command-children" aria-label="Summary command details">
										{#each row.block.command.summaryChildren as child (child.commandId)}
											<div class="reference-command-child">
												<strong>{child.title}</strong>
												<span>{child.summary}</span>
											</div>
										{/each}
									</div>
								{/if}
								{#if onInspectCommand}
									<Button size="sm" variant="ghost" onclick={() => row.block.kind === "command-rollup" && onInspectCommand?.(row.block.command.commandId)}>
										Inspect {commandStatusLabel(row.block.command.status)}
									</Button>
								{/if}
							</div>
						{:else if row.block.kind === "handoff-episode"}
							<EpisodeCard
								episode={episodeTranscript(row.block)}
								onartifactopen={(artifact) => onOpenArtifact(artifact.name)}
							/>
						{:else if row.block.kind === "thread"}
							<ThreadCard
								thread={threadTranscript(row.block.thread)}
								subagents={subagentTranscripts(row.block.thread)}
								onopen={() => row.block.kind === "thread" && onOpenHandlerThread?.(row.block.thread.threadId)}
								onworkflowopen={(workflow) => onInspectWorkflow?.(workflow.id)}
								onsubagentopen={(agent) => onInspectWorkflowTaskAttempt?.(agent.id)}
							/>
						{/if}
					</section>
				{:else if row?.kind === "message" && row.message.role === "user"}
					{@const message = row.message}
					<article
						data-index={virtualRow.index}
						use:measureTranscriptRow
						class="message-row virtual-row user-row"
						style={`transform: translate3d(0, ${virtualRow.start}px, 0);`}
					>
					<div
						class={`message-bubble user-bubble ${isHandlerObjectiveMessage(message) ? "handler-objective-bubble" : ""} ${isEditingUserMessage(message) ? "editing-user-bubble" : ""}`.trim()}
					>
						<header>
							<span>{isHandlerObjectiveMessage(message) ? "Objective" : "You"}</span>
							<div class="message-header-actions">
								<time>{formatTimestamp(message.timestamp)}</time>
								<Tooltip label="Copy message" disabled={!userDraftText(message)}>
									<Button
										variant="ghost"
										size="xs"
										iconOnly
										aria-label="Copy message"
										disabled={!userDraftText(message)}
										onclick={() => void handleCopyUserMessage(message)}
									>
										{#if copiedUserMessageTimestamp === String(message.timestamp)}
											<CheckIcon aria-hidden="true" size={13} strokeWidth={1.9} />
										{:else}
											<CopyIcon aria-hidden="true" size={13} strokeWidth={1.9} />
										{/if}
									</Button>
								</Tooltip>
								{#if onEditUserMessage}
									<Tooltip label={isStreaming ? "Wait for the current turn to finish" : "Edit message"}>
										<Button
											variant="ghost"
											size="xs"
											iconOnly
											aria-label="Edit message"
											disabled={isStreaming}
											onclick={() => onEditUserMessage?.(message, userDraftText(message))}
										>
											<PencilIcon aria-hidden="true" size={13} strokeWidth={1.9} />
										</Button>
									</Tooltip>
								{/if}
							</div>
						</header>
						{#each userTextLines(message) as line, lineIndex (`${message.timestamp}:line:${lineIndex}`)}
							<p class="message-text">
								{#each userLineSegments(line) as segment, segmentIndex (`${message.timestamp}:line:${lineIndex}:segment:${segmentIndex}`)}
									{#if segment.type === "mention"}
										<Tooltip label={segment.missing ? `Missing workspace path: ${segment.path}` : `Workspace path: ${segment.path}`}>
											<a
												class={`workspace-mention-link ${segment.missing ? "missing" : ""}`.trim()}
												href={`workspace://${segment.path}`}
												aria-disabled={segment.missing}
												onclick={(event) => handleWorkspaceMentionClick(event, segment.path ?? "", segment.missing)}
											>{segment.text}</a>
										</Tooltip>
									{:else}
										{segment.text}
									{/if}
								{/each}
							</p>
						{/each}
						{#if userAttachments(message).length > 0}
							<div class="user-attachments" aria-label="Attached files">
								{#if userImageAttachments(message).length > 0}
									<div class="user-image-gallery" aria-label="Attached images">
										{#each userImageAttachments(message) as imageAttachment (`${message.timestamp}:image-attachment:${imageAttachment.attachment.id}`)}
											<figure class="user-image-attachment">
												{#if imageAttachment.imageData}
													<img src={imageAttachment.imageData} alt={`User attached image ${imageAttachment.attachment.name}`} />
												{:else}
													<div class="user-attachment-icon large" aria-hidden="true">
														<ImageIcon size={18} strokeWidth={1.8} />
													</div>
												{/if}
												<figcaption>
													<strong>{imageAttachment.attachment.name}</strong>
													<span>{userAttachmentCaption(imageAttachment.attachment)}</span>
												</figcaption>
											</figure>
										{/each}
									</div>
								{/if}
								{#if userFileAttachments(message).length > 0}
									<div class="user-file-list" aria-label="Attached files and folders">
										{#each userFileAttachments(message) as attachment (`${message.timestamp}:file-attachment:${attachment.id}`)}
											<div class="user-file-attachment">
												<div class="user-attachment-icon" aria-hidden="true">
													{#if attachment.kind === "folder"}
														<FolderIcon size={16} strokeWidth={1.8} />
													{:else}
														<FileIcon size={16} strokeWidth={1.8} />
													{/if}
												</div>
												<div class="user-file-attachment-copy">
													<strong>{attachment.name}</strong>
													<span>{userAttachmentCaption(attachment)}</span>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				</article>
				{:else if row?.kind === "message" && row.message.role === "assistant"}
					{@const message = row.message}
					{@const messageBudget = assistantMessageContextBudget(message)}
					{@const turnTiming = assistantTurnTiming(message)}
					<article
						data-index={virtualRow.index}
						use:measureTranscriptRow
						class="message-row virtual-row assistant-row"
						style={`transform: translate3d(0, ${virtualRow.start}px, 0);`}
					>
					<div class="message-bubble assistant-bubble">
						<header>
							<div>
								<span>svvy</span>
								<small>{message.provider} · {message.model}</small>
							</div>
						</header>

						{#each message.content as block, blockIndex (`${message.timestamp}:block:${blockIndex}`)}
							{#if block.type === "text"}
								<div class="message-text">
									<AssistantMarkdown content={block.text} isFinished={true} />
								</div>
							{:else if block.type === "thinking"}
								<details class="thinking-block">
									<summary>Reasoning</summary>
									<div class="thinking-markdown">
										<AssistantMarkdown content={thinkingDisplayText(block)} isFinished={true} />
									</div>
								</details>
							{:else if block.type === "toolCall"}
								{@const projectedToolCall = conversation.toolCallsById.get(block.id)}
								{@const params = projectedToolCall?.artifactParams ?? parseArtifactsParams(block.arguments)}
								{@const resultMessage = conversation.toolResultsById.get(block.id)}
								{@const toolArguments = projectedToolCall?.argumentsValue ?? block.arguments}
								{@const toolBody = toolInputBody(block.name, toolArguments)}
								{@const status = toolStatus(block.id)}
								<ToolCallCard
									toolCall={{
										id: block.id,
										name: block.name,
										status: status === "done" ? "done" : status === "error" ? "failed" : "running",
										params,
										body: toolBody,
										result: toolResultPreview(resultMessage),
										isError: status === "error" || resultMessage?.isError,
										attempt: projectedToolCall?.attempt,
										totalAttempts: projectedToolCall?.totalAttempts,
									}}
									onopen={onOpenArtifact}
								/>
							{/if}
						{/each}
						<footer class="assistant-message-footer">
							<div class="assistant-message-actions" aria-label="Assistant message actions">
								<time>{formatTimestamp(message.timestamp)}</time>
								{#if turnTiming}
									{@const turnDurationTooltip = formatTurnDurationTooltip(turnTiming.startedAt, turnTiming.finishedAt)}
										<Tooltip label={turnDurationTooltip}>
											<span class="assistant-turn-duration" aria-label={turnDurationTooltip}>
												<ClockIcon
													class="assistant-turn-duration-icon"
													aria-hidden="true"
													size={12}
													strokeWidth={1.9}
												/>
												<span>{formatTurnDuration(turnTiming.startedAt, turnTiming.finishedAt)}</span>
											</span>
										</Tooltip>
								{/if}
								<Tooltip label="Fork session from this message">
									<Button
										variant="ghost"
										size="xs"
										iconOnly
										aria-label="Fork session from this message"
										onclick={() => onForkAssistantMessage?.(message)}
									>
										<GitForkIcon aria-hidden="true" size={13} strokeWidth={1.9} />
									</Button>
								</Tooltip>
								<Tooltip label="Copy assistant message" disabled={!assistantMessageText(message)}>
									<Button
										variant="ghost"
										size="xs"
										iconOnly
										aria-label="Copy assistant message"
										disabled={!assistantMessageText(message)}
										onclick={() => void handleCopyAssistantMessage(message)}
									>
										{#if copiedAssistantMessageTimestamp === message.timestamp}
											<CheckIcon aria-hidden="true" size={13} strokeWidth={1.9} />
										{:else}
											<CopyIcon aria-hidden="true" size={13} strokeWidth={1.9} />
										{/if}
									</Button>
								</Tooltip>
							</div>
							{#if messageBudget}
								<ContextBudgetBar
									budget={messageBudget}
									variant="inline"
									label="Message context"
									tooltipLabel=""
									tooltipDetails={assistantMessageContextTooltipDetails(message, messageBudget)}
								/>
							{/if}
						</footer>
						</div>
					</article>
				{:else if row?.kind === "message" && row.message.role === "toolResult"}
					{@const message = row.message}
					<article
						data-index={virtualRow.index}
						use:measureTranscriptRow
						class="message-row virtual-row tool-row"
						style={`transform: translate3d(0, ${virtualRow.start}px, 0);`}
					>
						<ToolCallCard
							toolCall={{
								id: message.toolCallId,
								name: message.toolName,
								status: message.isError ? "failed" : "done",
								body: toolInputBody(message.toolName, undefined),
								result: toolResultPreview(message),
								isError: message.isError,
							}}
							onopen={onOpenArtifact}
						/>
					</article>
				{/if}
			{/each}
		</div>
		{#if streamingAssistant}
			{@const message = streamingAssistant}
			<article class="message-row assistant-row streaming-row" aria-live="polite">
				<div class="message-bubble assistant-bubble streaming">
					<header>
						<div>
							<span>svvy</span>
							<small>{message.provider} · {message.model}</small>
						</div>
					</header>

					{#each message.content as block, blockIndex (`streaming:${blockIndex}`)}
						{#if block.type === "text"}
							<div class="message-text">
								<AssistantMarkdown content={block.text} isFinished={false} />
							</div>
						{:else if block.type === "thinking"}
							<details class="thinking-block">
								<summary>Reasoning</summary>
								<div class="thinking-markdown">
									<AssistantMarkdown content={thinkingDisplayText(block)} isFinished={false} />
								</div>
							</details>
						{:else if block.type === "toolCall"}
							{@const params = parseArtifactsParams(block.arguments)}
							{@const toolBody = executeTypescriptBody(block.name, block.arguments)}
							<ToolCallCard
								toolCall={{
									id: `streaming-${blockIndex}`,
									name: block.name,
									status: "running",
									params,
									body: toolBody,
								}}
								onopen={onOpenArtifact}
							/>
						{/if}
					{/each}
					<footer class="assistant-message-footer streaming-footer">
						<div class="assistant-message-actions" aria-label="Assistant message status">
							<time>{formatTimestamp(message.timestamp)}</time>
							<span class="tool-status tone-warning">Streaming</span>
						</div>
					</footer>
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
		overflow-anchor: none;
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
			transition:
				background-color 160ms cubic-bezier(0.19, 1, 0.22, 1),
				border-color 160ms cubic-bezier(0.19, 1, 0.22, 1),
				box-shadow 160ms cubic-bezier(0.19, 1, 0.22, 1);
		}

		.handler-objective-bubble {
			width: min(100%, 45.5rem);
			border-color: color-mix(in oklab, var(--ui-accent) 34%, var(--ui-border-soft));
			background: color-mix(in oklab, var(--ui-accent-soft) 34%, var(--ui-surface-subtle));
		}

		.editing-user-bubble {
			border-color: color-mix(in oklab, var(--ui-accent) 62%, var(--ui-border-soft));
			background: color-mix(in oklab, var(--ui-accent-soft) 46%, var(--ui-surface-subtle));
			box-shadow:
				inset 2px 0 0 color-mix(in oklab, var(--ui-accent) 78%, transparent),
				0 0 0 1px color-mix(in oklab, var(--ui-accent) 16%, transparent);
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
		font-size: var(--text-xs);
	}

	.reference-command-child strong {
		color: var(--ui-text-secondary);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.message-bubble header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.65rem;
		margin-bottom: 0.45rem;
	}

	.message-bubble header span {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		color: var(--ui-text-tertiary);
	}

	.message-bubble header small,
	time {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ui-text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.message-header-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.18rem;
		min-width: 0;
	}

	.tool-result-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.tool-status {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ui-text-secondary);
	}

	.tool-attempt {
		font-size: var(--text-xs);
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
		font-size: var(--text-base);
		line-height: 1.58;
		color: var(--ui-text-primary);
	}

	.message-text + .message-text {
		margin-top: 0.72rem;
	}

	.user-attachments {
		display: grid;
		gap: 0.62rem;
		margin-top: 0.72rem;
		max-height: min(24rem, 52vh);
		overflow-y: auto;
		overscroll-behavior: contain;
		padding-right: 0.2rem;
		scrollbar-gutter: stable;
	}

	.user-image-gallery {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.58rem;
	}

	.user-image-attachment {
		flex: 1 1 14rem;
		display: grid;
		gap: 0.38rem;
		margin: 0;
		max-width: 28rem;
		min-width: 0;
	}

	.user-image-attachment img {
		display: block;
		width: 100%;
		max-height: 16rem;
		object-fit: contain;
		border: 1px solid var(--ui-border-soft);
		border-radius: var(--ui-radius-sm);
		background: var(--ui-code);
	}

	.user-attachment-icon {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: 1px solid var(--ui-border-soft);
		border-radius: var(--ui-radius-sm);
		background: var(--ui-code);
		color: var(--ui-text-secondary);
	}

	.user-attachment-icon.large {
		width: 100%;
		min-height: 7.5rem;
	}

	.user-image-attachment figcaption,
	.user-file-attachment-copy {
		display: grid;
		gap: 0.12rem;
		min-width: 0;
	}

	.user-image-attachment figcaption strong,
	.user-image-attachment figcaption span,
	.user-file-attachment-copy strong,
	.user-file-attachment-copy span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.user-image-attachment figcaption strong,
	.user-file-attachment-copy strong {
		color: var(--ui-text-secondary);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.user-image-attachment figcaption span,
	.user-file-attachment-copy span {
		color: var(--ui-text-tertiary);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.user-file-list {
		display: grid;
		gap: 0.34rem;
		max-width: 30rem;
	}

	.user-file-attachment {
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr);
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		padding: 0.42rem 0.52rem;
		border: 1px solid var(--ui-border-soft);
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-code) 72%, transparent);
	}

	.assistant-message-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.55rem;
		margin-top: 0.6rem;
		color: var(--ui-text-secondary);
		opacity: 0.74;
		transition: opacity 150ms ease;
	}

	.assistant-message-actions {
		display: flex;
		align-items: center;
		gap: 0.18rem;
		min-width: 0;
		color: var(--ui-text-secondary);
	}

	.assistant-message-actions time {
		margin-right: 0.16rem;
	}

	.assistant-turn-duration {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		min-width: 0;
		height: 1.38rem;
		padding: 0 0.34rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-surface-subtle) 60%, transparent);
		color: var(--ui-text-secondary);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		line-height: 1;
		white-space: nowrap;
	}

	.assistant-turn-duration-icon {
		flex: 0 0 auto;
		color: color-mix(in oklab, var(--ui-warning) 76%, var(--ui-text-secondary));
	}

	.assistant-bubble:hover .assistant-message-footer,
	.assistant-bubble:focus-within .assistant-message-footer {
		opacity: 1;
	}

	.assistant-message-footer :global(.context-budget-inline) {
		flex: 0 0 5.7rem;
		margin-left: auto;
	}

	.streaming-footer {
		justify-content: flex-start;
	}

	@container (max-width: 34rem) {
		.assistant-message-footer {
			gap: 0.38rem;
		}

		.assistant-message-footer :global(.context-budget-inline) {
			flex-basis: 5.2rem;
		}
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

	.thinking-block {
		margin-top: 0.8rem;
		min-width: 0;
		padding: 0.78rem 0 0;
		border-radius: 0;
		border: none;
		border-top: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
		background: transparent;
	}

	.thinking-block[open] {
		margin-bottom: 0.72rem;
	}

	.system-prompt-block {
		margin-top: 0;
		padding-top: 0;
		border-top: none;
	}

	.thinking-block summary {
		cursor: pointer;
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: 0;
		color: var(--ui-text-secondary);
	}

	.thinking-markdown {
		margin-top: 0.55rem;
		max-width: 100%;
		overflow-wrap: anywhere;
		word-break: break-word;
		font-size: var(--text-base);
		line-height: 1.6;
		color: var(--ui-text-secondary);
	}

	.thinking-markdown :global(.assistant-markdown) {
		color: var(--ui-text-secondary);
		font-size: inherit;
		line-height: inherit;
	}

	.thinking-markdown :global(.assistant-markdown h1),
	.thinking-markdown :global(.assistant-markdown h2),
	.thinking-markdown :global(.assistant-markdown h3),
	.thinking-markdown :global(.assistant-markdown h4),
	.thinking-markdown :global(.assistant-markdown h5),
	.thinking-markdown :global(.assistant-markdown h6) {
		color: var(--ui-text-secondary);
	}

	.thinking-markdown :global(.assistant-markdown code) {
		color: color-mix(in oklab, var(--ui-text-secondary) 92%, var(--ui-accent));
	}

	.thinking-markdown :global(.assistant-markdown pre code) {
		color: var(--ui-text-secondary);
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
