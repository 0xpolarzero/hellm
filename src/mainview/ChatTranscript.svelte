<script lang="ts">
	import type {
		RendererTranscriptAssistantEntry,
		RendererCommandResultEntry,
		RendererTranscriptUserEntry,
	} from "../shared/renderer-transcript";
	import CheckIcon from "@lucide/svelte/icons/check";
	import ClockIcon from "@lucide/svelte/icons/clock";
	import CopyIcon from "@lucide/svelte/icons/copy";
	import FileIcon from "@lucide/svelte/icons/file";
	import FileTextIcon from "@lucide/svelte/icons/file-text";
	import FolderIcon from "@lucide/svelte/icons/folder";
	import GitForkIcon from "@lucide/svelte/icons/git-fork";
	import ImageIcon from "@lucide/svelte/icons/image";
	import PencilIcon from "@lucide/svelte/icons/pencil";
	import { createVirtualizer } from "@tanstack/svelte-virtual";
	import { onDestroy, onMount, tick } from "svelte";
	import { get } from "svelte/store";
	import { formatCost, formatTimestamp } from "./chat-format";
	import { buildContextBudgetFromUsage, type ContextBudget } from "./context-budget";
	import { parseTranscriptMentionLinks } from "./composer-mentions";
	import type { ConversationProjection, ProjectedToolCall } from "./conversation-projection";
	import {
		summarizeExecuteTypescriptResult,
		type TranscriptSemanticBlock,
	} from "./transcript-projection";
	import {
		TRANSCRIPT_STICK_TO_BOTTOM_THRESHOLD_PX,
		getTranscriptNativeScrollBehavior,
		resolveTranscriptRestoreTarget,
	} from "./transcript-scroll";
	import AssistantMarkdown from "./AssistantMarkdown.svelte";
	import ContextBudgetBar from "./ContextBudgetBar.svelte";
	import EpisodeCard, { type TranscriptEpisode } from "./transcript-cards/EpisodeCard.svelte";
	import FailedCard from "./transcript-cards/FailedCard.svelte";
	import type { TranscriptStatus } from "./transcript-cards/StatusBadge.svelte";
	import ThreadCard, { type TranscriptThread } from "./transcript-cards/ThreadCard.svelte";
	import ToolCallCard from "./transcript-cards/ToolCallCard.svelte";
	import WaitingCard from "./transcript-cards/WaitingCard.svelte";
	import {
		projectCommandToolCall,
		projectRawToolCall,
		toolResultText,
	} from "./tool-card-projection";
	import type { TranscriptWorkflow } from "./transcript-cards/WorkflowCard.svelte";
	import type { TranscriptToolCall } from "./transcript-tool-card-model";
	import {
		parseComposerAttachmentTextSignature,
		type ComposerAttachment,
		type ConversationTurnTiming,
		type PromptTarget,
		type SvvyUserMessage,
		type WorkspaceCommandRollup,
		type WorkspaceHandlerThreadSummary,
	} from "../shared/workspace-contract";
	import type { SentSnippetProvenance } from "../shared/snippets";
	import { rpc } from "./rpc";
	import Button from "./ui/Button.svelte";
	import Tooltip from "./ui/Tooltip.svelte";
	import { formatTurnDuration, formatTurnDurationTooltip } from "./working-timer";
	import type { RendererSurfaceModel } from "./chat-runtime";

	const DEFAULT_TRANSCRIPT_ROW_GAP = 16;
	type TranscriptArtifactOpenTarget = string | { id: string; name: string };

	type Props = {
		conversation: ConversationProjection;
		target?: PromptTarget | null;
		sessionId?: string;
		streamMessage?: RendererTranscriptAssistantEntry;
		currentModel?: RendererSurfaceModel | null;
		pendingToolCalls: ReadonlySet<string>;
		isStreaming: boolean;
		turnTimings: ConversationTurnTiming[];
		workspaceMentionPaths?: ReadonlySet<string>;
		semanticBlocks?: TranscriptSemanticBlock[];
		onOpenArtifact: (target: TranscriptArtifactOpenTarget) => void;
		onOpenWorkspacePath: (path: string) => void;
		onInspectCommand?: (commandId: string) => void;
		onOpenHandlerThread?: (threadId: string) => void;
		onInspectWorkflow?: (workflowId: string) => void;
		onInspectWorkflowTaskAttempt?: (workflowTaskAttemptId: string) => void;
		onForkAssistantMessage?: (message: RendererTranscriptAssistantEntry) => void;
		onEditUserMessage?: (message: RendererTranscriptUserEntry, text: string) => void;
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
	let transcriptRowGap = $state(DEFAULT_TRANSCRIPT_ROW_GAP);
	let transcriptPinnedToEnd = $state(true);
	let copiedAssistantMessageTimestamp = $state<number | null>(null);
	let copiedUserMessageTimestamp = $state<string | null>(null);
	let transcriptSessionId: string | undefined = undefined;
	let transcriptSessionInitialized = false;
	let restoredInitialScrollForSession: string | undefined = undefined;
	let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

	const streamingAssistant = $derived(streamMessage ?? null);
	const commandRollupByToolCallId = $derived.by(() => {
		const byToolCallId = new Map<string, WorkspaceCommandRollup>();
		for (const block of semanticBlocks) {
			if (block.kind !== "command-rollup") continue;
			const toolCallId = block.command.facts?.toolCallId;
			if (typeof toolCallId === "string" && toolCallId) {
				byToolCallId.set(toolCallId, block.command);
			}
		}
		return byToolCallId;
	});
	const representedToolCallIds = $derived.by(() => {
		const ids = new Set<string>(conversation.toolCallsById.keys());
		for (const block of streamingAssistant?.content ?? []) {
			if (block.type === "tool-call") ids.add(block.id);
		}
		return ids;
	});
	const turnTimingByAssistantTimestamp = $derived.by(() => {
		const timings = new Map<string, ConversationTurnTiming>();
		for (const timing of turnTimings) {
			timings.set(String(timing.assistantMessageTimestamp), timing);
		}
		return timings;
	});
	type AssistantContentBlock = RendererTranscriptAssistantEntry["content"][number];
	function thinkingDisplayText(block: Extract<AssistantContentBlock, { type: "thinking" }>): string {
		if (block.thinking.trim()) return block.thinking;
		if (block.redacted) return "[redacted]";
		if (block.thinkingSignature) return "Reasoning summary unavailable";
		return "(empty)";
	}

	type TranscriptRow =
		| { kind: "semantic"; key: string; block: TranscriptSemanticBlock; sortAt: number; sequence: number }
		| { kind: "message"; key: string; message: RendererTranscriptUserEntry | RendererTranscriptAssistantEntry | RendererCommandResultEntry; sortAt: number; sequence: number }
		| { kind: "streaming"; key: string; message: RendererTranscriptAssistantEntry; sortAt: number; sequence: number };
	const transcriptRows = $derived.by<TranscriptRow[]>(() => {
		const rows: TranscriptRow[] = [];
		let sequence = 0;
		for (const message of conversation.visibleMessages) {
			if (message.role === "command-result" && conversation.toolCallsById.has(message.toolCallId)) {
				continue;
			}
			rows.push({
				kind: "message",
				key: `${message.role}:${message.timestamp}`,
				message,
				sortAt: timestampMs(message.timestamp),
				sequence: sequence++,
			});
		}
		for (const block of semanticBlocks) {
			if (block.kind === "command-rollup") {
				const toolCallId = block.command.facts?.toolCallId;
				if (typeof toolCallId === "string" && representedToolCallIds.has(toolCallId)) {
					continue;
				}
			}
			rows.push({
				kind: "semantic",
				key: `semantic:${block.key}`,
				block,
				sortAt: semanticBlockSortAt(block),
				sequence: sequence++,
			});
		}
		if (streamingAssistant) {
			rows.push({
				kind: "streaming",
				key: `streaming:${streamingAssistant.timestamp}`,
				message: streamingAssistant,
				sortAt: timestampMs(streamingAssistant.timestamp),
				sequence: sequence++,
			});
		}
		return rows.toSorted((left, right) => left.sortAt - right.sortAt || left.sequence - right.sequence);
	});
	const transcriptVirtualizer = createVirtualizer<HTMLDivElement, HTMLElement>({
		count: 0,
		getScrollElement: () => scroller,
		estimateSize: (index) => estimateTranscriptRowSize(transcriptRows[index]),
		getItemKey: (index) => transcriptRows[index]?.key ?? index,
		overscan: 10,
		gap: DEFAULT_TRANSCRIPT_ROW_GAP,
		anchorTo: "end",
		scrollEndThreshold: TRANSCRIPT_STICK_TO_BOTTOM_THRESHOLD_PX,
		followOnAppend: "auto",
		enabled: true,
	});
	const virtualRows = $derived($transcriptVirtualizer.getVirtualItems());
	const firstVirtualRowStart = $derived(virtualRows[0]?.start ?? 0);
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
		if (row.kind === "semantic") return 156;
		if (row.kind === "streaming") return 172;
		if (row.message.role === "user") return 96;
		if (row.message.role === "command-result") return 148;
		return 172;
	}

	function timestampMs(value: string | number | null | undefined): number {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string") {
			const parsed = Date.parse(value);
			if (Number.isFinite(parsed)) return parsed;
			const numeric = Number(value);
			if (Number.isFinite(numeric)) return numeric;
		}
		return Number.MAX_SAFE_INTEGER;
	}

	function semanticBlockSortAt(block: TranscriptSemanticBlock): number {
		if (block.kind === "wait") return timestampMs(block.since);
		if (block.kind === "command-rollup") return timestampMs(block.command.startedAt ?? block.command.updatedAt);
		if (block.kind === "product-event") return timestampMs(block.event.at);
		if (block.kind === "thread") return timestampMs(block.thread.startedAt);
		if (block.kind === "thread-episode") return timestampMs(block.episode.createdAt);
		return Number.MAX_SAFE_INTEGER;
	}

	function userTextLines(message: RendererTranscriptUserEntry): string[] {
		if (typeof message.content === "string") return [message.content];
		return message.content
			.filter(
				(block): block is { type: "text"; text: string; textSignature?: string } =>
					block.type === "text" && parseComposerAttachmentTextSignature(block.textSignature).length === 0,
			)
			.map((block) => block.text);
	}

	function userDraftText(message: RendererTranscriptUserEntry): string {
		return userTextLines(message).join("\n\n").trim();
	}

	function isEditingUserMessage(message: RendererTranscriptUserEntry): boolean {
		return (
			editingUserMessageTimestamp !== null &&
			String(message.timestamp) === String(editingUserMessageTimestamp)
		);
	}

	function assistantTurnTiming(message: RendererTranscriptAssistantEntry): ConversationTurnTiming | null {
		return turnTimingByAssistantTimestamp.get(String(message.timestamp)) ?? null;
	}

	function userImageBlocks(message: RendererTranscriptUserEntry) {
		if (typeof message.content === "string") return [];
		return message.content.filter((block) => block.type === "image");
	}

	function userAttachments(message: RendererTranscriptUserEntry): ComposerAttachment[] {
		if (typeof message.content === "string") return [];
		return message.content.flatMap((block) =>
			block.type === "text" ? parseComposerAttachmentTextSignature(block.textSignature) : [],
		);
	}

	function userSnippetProvenance(message: RendererTranscriptUserEntry): SentSnippetProvenance[] {
		return (message as SvvyUserMessage).svvyMetadata?.snippetProvenance ?? [];
	}

	function userImageAttachments(message: RendererTranscriptUserEntry): Array<{ attachment: ComposerAttachment; imageData: string | null }> {
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

	function userFileAttachments(message: RendererTranscriptUserEntry): ComposerAttachment[] {
		return userAttachments(message).filter((attachment) => attachment.kind !== "image");
	}

	function userAttachmentCaption(attachment: ComposerAttachment): string {
		return attachment.workspaceRelativePath ?? attachment.path;
	}

	function isHandlerObjectiveMessage(message: RendererTranscriptUserEntry): boolean {
		if (target?.surface !== "handler") return false;
		const firstUserMessage = conversation.visibleMessages.find(
			(candidate): candidate is RendererTranscriptUserEntry => candidate.role === "user",
		);
		return firstUserMessage === message;
	}

	function userLineSegments(line: string) {
		return parseTranscriptMentionLinks(line, workspaceMentionPaths);
	}

	function assistantMessageText(message: RendererTranscriptAssistantEntry): string {
		return message.content
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("\n\n")
			.trim();
	}

	function exactTokenCount(count: number): string {
		return count.toLocaleString("en-US");
	}

	function knownModelContextWindow(message: RendererTranscriptAssistantEntry): number | null {
		if (currentModel?.provider === message.provider && currentModel.id === message.model) {
			return currentModel.contextWindow;
		}
		return null;
	}

	function assistantMessageContextBudget(message: RendererTranscriptAssistantEntry): ContextBudget | null {
		return buildContextBudgetFromUsage(message.usage, knownModelContextWindow(message));
	}

	function assistantMessageContextTooltipDetails(message: RendererTranscriptAssistantEntry, budget: ContextBudget) {
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

	async function handleCopyAssistantMessage(message: RendererTranscriptAssistantEntry) {
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

	async function handleCopyUserMessage(message: RendererTranscriptUserEntry) {
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

	function resultDetailsText(message: RendererCommandResultEntry): string {
		return toolResultText(message);
	}

	function commandTranscriptStatus(status: string): TranscriptStatus {
		if (status === "succeeded" || status === "completed" || status === "passed") return "done";
		if (status === "failed" || status === "cancelled") return "failed";
		if (status === "blocked" || status === "troubleshooting") return "blocked";
		if (status === "waiting" || status === "requested") return "waiting";
		if (status === "streaming" || status === "running" || status === "running-handler" || status === "running-workflow" || status === "continued") return "running";
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

	function commandToolCall(command: WorkspaceCommandRollup): TranscriptToolCall {
		return projectCommandToolCall(command);
	}

	function commandRollupTranscript(command: TranscriptSemanticBlock & { kind: "command-rollup" }): TranscriptToolCall {
		return commandToolCall(command.command);
	}

	function episodeTranscript(block: TranscriptSemanticBlock & { kind: "thread-episode" }): TranscriptEpisode {
		return {
			id: block.episode.episodeId,
			title: block.episode.title,
			summary: block.episode.summary,
			thread: block.thread.title,
			verified: block.episode.kind !== "clarification",
		};
	}

	function threadTranscript(handlerThread: WorkspaceHandlerThreadSummary): TranscriptThread {
		const currentActivity = handlerThread.wait
			? {
					title: `Waiting on ${handlerThread.wait.owner}`,
					summary: handlerThread.wait.reason,
					status: "waiting" as TranscriptStatus,
					updatedAt: handlerThread.wait.since,
				}
			: handlerThread.latestCommandRollup
				? {
						title: handlerThread.latestCommandRollup.title,
						summary: handlerThread.latestCommandRollup.summary,
						status: commandTranscriptStatus(handlerThread.latestCommandRollup.status),
						updatedAt: handlerThread.latestCommandRollup.updatedAt,
						commandId: handlerThread.latestCommandRollup.commandId,
					}
				: handlerThread.latestWorkflowRun
					? {
							title: handlerThread.latestWorkflowRun.workflowName,
							summary: handlerThread.latestWorkflowRun.summary,
							status: commandTranscriptStatus(handlerThread.latestWorkflowRun.status),
							updatedAt: handlerThread.latestWorkflowRun.updatedAt,
						}
					: undefined;
		return {
			id: handlerThread.threadId,
			title: handlerThread.title,
			objective: handlerThread.objective,
			status: commandTranscriptStatus(handlerThread.status),
			elapsed: formatTimestamp(handlerThread.updatedAt),
			model: "handler-thread",
			currentActivity,
			latestReport: handlerThread.latestEpisode
				? {
						episodeId: handlerThread.latestEpisode.episodeId,
						kind: handlerThread.latestEpisode.kind,
						title: handlerThread.latestEpisode.title,
						summary: handlerThread.latestEpisode.summary,
						createdAt: formatTimestamp(handlerThread.latestEpisode.createdAt),
					}
				: undefined,
			metrics: [
				`${handlerThread.commandCount} commands`,
				`${handlerThread.episodeCount} reports`,
				`${handlerThread.artifactCount} artifacts`,
			],
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

	function toolResultPreview(message: RendererCommandResultEntry | undefined): string | null {
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

	function transcriptFollowBehavior(): ScrollBehavior | false {
		if (!transcriptPinnedToEnd) return false;
		return getTranscriptNativeScrollBehavior({
			animated: true,
			reducedMotion: prefersReducedMotion(),
		});
	}

	function currentTranscriptAnchorIndex(): number {
		if (!scroller) return 0;
		return $transcriptVirtualizer.getVirtualItemForOffset(scroller.scrollTop)?.index ?? 0;
	}

	function persistCurrentScrollState(anchorIndex = currentTranscriptAnchorIndex()) {
		if (!scroller) return;
		onScrollStateChange?.({
			transcriptAnchorId: transcriptRows[anchorIndex]?.key ?? null,
			offsetPx: scroller.scrollTop,
		});
	}

	function syncTranscriptScrollStateFromScroller() {
		if (!scroller) return;
		transcriptPinnedToEnd = $transcriptVirtualizer.isAtEnd(
			TRANSCRIPT_STICK_TO_BOTTOM_THRESHOLD_PX,
		);
		persistCurrentScrollState();
	}

	function handleScroll() {
		syncTranscriptScrollStateFromScroller();
	}

	function syncViewportMetrics() {
		if (!scroller) return;
		if (threadElement) {
			const rowGap = parseFloat(getComputedStyle(threadElement).rowGap || "16");
			if (Number.isFinite(rowGap) && rowGap > 0) {
				transcriptRowGap = rowGap;
			}
		}
		if (transcriptPinnedToEnd) {
			$transcriptVirtualizer.scrollToEnd({ behavior: "auto" });
		}
	}

	function measureTranscriptRow(node: HTMLElement) {
		$transcriptVirtualizer.measureElement(node);
		const observer = new ResizeObserver(() => {
			$transcriptVirtualizer.measureElement(node);
		});
		observer.observe(node);
		return {
			update() {
				$transcriptVirtualizer.measureElement(node);
			},
			destroy() {
				observer.disconnect();
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

		if (scrollElement) observer.observe(scrollElement);
		if (transcriptThreadElement) observer.observe(transcriptThreadElement);

		return () => {
			observer.disconnect();
		};
	});

	onDestroy(() => {
		if (copyResetTimer) {
			clearTimeout(copyResetTimer);
			copyResetTimer = null;
		}
	});

	$effect(() => {
		void sessionId;

		if (transcriptSessionInitialized && sessionId === transcriptSessionId) return;
		transcriptSessionInitialized = true;
		transcriptSessionId = sessionId;
		transcriptPinnedToEnd = true;
	}
	);

	$effect(() => {
		void transcriptRows.length;
		void transcriptRows;
		void transcriptRowGap;
		void transcriptPinnedToEnd;
		void scroller;
		get(transcriptVirtualizer).setOptions({
			count: transcriptRows.length,
			getScrollElement: () => scroller,
			estimateSize: (index) => estimateTranscriptRowSize(transcriptRows[index]),
			getItemKey: (index) => transcriptRows[index]?.key ?? index,
			gap: transcriptRowGap,
			anchorTo: "end",
			scrollEndThreshold: TRANSCRIPT_STICK_TO_BOTTOM_THRESHOLD_PX,
			followOnAppend: transcriptFollowBehavior(),
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
		const restoreTarget = resolveTranscriptRestoreTarget({
			anchorId: initialScroll.transcriptAnchorId,
			offsetPx: initialScroll.offsetPx,
			rows: transcriptRows,
			getRowKey: (row) => row.key,
		});
		if (restoreTarget.kind === "anchor") {
			get(transcriptVirtualizer).scrollToIndex(restoreTarget.index, { align: "start" });
		} else {
			get(transcriptVirtualizer).scrollToOffset(restoreTarget.offsetPx);
		}
		syncTranscriptScrollStateFromScroller();
	});

	$effect(() => {
		void conversation.visibleMessages.length;
		void conversation.toolResultsById;
		void streamingAssistant;
		void pendingToolCalls;
		void isStreaming;

		if (!scroller || !transcriptPinnedToEnd) return;
		void tick().then(() => {
			if (!scroller) return;
			$transcriptVirtualizer.scrollToEnd({
				behavior: getTranscriptNativeScrollBehavior({
					animated: true,
					reducedMotion: prefersReducedMotion(),
				}),
			});
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
			<div
				class="chat-thread-virtual-block"
				style={`transform: translate3d(0, ${firstVirtualRowStart}px, 0); gap: ${transcriptRowGap}px;`}
			>
				{#each virtualRows as virtualRow (virtualRow.key)}
					{@const row = transcriptRows[virtualRow.index]}
					{#if row?.kind === "semantic"}
						<section
							data-index={virtualRow.index}
							use:measureTranscriptRow
							class="transcript-semantic-stack virtual-row"
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
								<ToolCallCard
									toolCall={commandRollupTranscript(row.block)}
									oninspect={onInspectCommand}
									onopen={(artifact) => onOpenArtifact({ id: artifact.id, name: artifact.name })}
									oncopy={copyTextToClipboard}
								/>
							</div>
						{:else if row.block.kind === "product-event"}
							<div class="product-event-block">
								<strong>{row.block.event.title}</strong>
								<span>{row.block.event.summary}</span>
								<time datetime={row.block.event.at}>{formatTimestamp(row.block.event.at)}</time>
							</div>
						{:else if row.block.kind === "thread-episode"}
							<EpisodeCard
								episode={episodeTranscript(row.block)}
								onartifactopen={(artifact) => onOpenArtifact(artifact)}
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
						{#if userSnippetProvenance(message).length > 0}
							<div class="user-snippet-list" aria-label="Snippets used">
								{#each userSnippetProvenance(message) as snippet (`${message.timestamp}:snippet:${snippet.mentionId}`)}
									<details class="user-snippet-chip">
										<summary>
											<FileTextIcon size={14} strokeWidth={1.8} aria-hidden="true" />
											<strong>{snippet.title}</strong>
											<span>{snippet.source}</span>
										</summary>
										<div class="user-snippet-detail">
											{#if snippet.path}
												<p>{snippet.path}</p>
											{/if}
											{#if snippet.arguments.length > 0}
												<p>Arguments: {snippet.arguments.join(" ")}</p>
											{/if}
											<pre>{snippet.resolvedText}</pre>
										</div>
									</details>
								{/each}
							</div>
						{/if}
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
							{:else if block.type === "tool-call"}
								{@const projectedToolCall = conversation.toolCallsById.get(block.id)}
								{@const resultMessage = conversation.toolResultsById.get(block.id)}
								{@const matchedCommand = commandRollupByToolCallId.get(block.id)}
								{@const toolArguments = projectedToolCall?.argumentsValue ?? block.arguments}
								{@const status = toolStatus(block.id)}
								{@const matchedCommandCard = matchedCommand ? commandToolCall(matchedCommand) : null}
								<ToolCallCard
									toolCall={matchedCommand && matchedCommandCard
										? {
												...matchedCommandCard,
												id: block.id,
												outcome: matchedCommandCard.outcome ?? toolResultPreview(resultMessage),
												isError: matchedCommand.status === "failed" || status === "error" || resultMessage?.isError,
												attempt: projectedToolCall?.attempt,
												totalAttempts: projectedToolCall?.totalAttempts,
											}
										: projectRawToolCall({
												id: block.id,
												name: block.name,
												status: status === "done" ? "done" : status === "error" ? "failed" : "running",
												result: toolResultPreview(resultMessage),
												argumentsValue: toolArguments,
												isError: status === "error" || resultMessage?.isError,
												attempt: projectedToolCall?.attempt,
												totalAttempts: projectedToolCall?.totalAttempts,
											})}
									oninspect={onInspectCommand}
									onopen={(artifact) => onOpenArtifact({ id: artifact.id, name: artifact.name })}
									oncopy={copyTextToClipboard}
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
				{:else if row?.kind === "streaming"}
					{@const message = row.message}
					<article
						data-index={virtualRow.index}
						use:measureTranscriptRow
						class="message-row virtual-row assistant-row streaming-row"
						aria-live="polite"
					>
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
								{:else if block.type === "tool-call"}
									{@const matchedCommand = commandRollupByToolCallId.get(block.id)}
									{@const matchedCommandCard = matchedCommand ? commandToolCall(matchedCommand) : null}
									<ToolCallCard
										toolCall={matchedCommand && matchedCommandCard
											? {
													...matchedCommandCard,
													id: block.id,
													status: "running",
													isError: matchedCommand.status === "failed",
												}
											: projectRawToolCall({
													id: block.id,
													name: block.name,
													status: "running",
													argumentsValue: block.arguments,
												})}
										oninspect={onInspectCommand}
										onopen={(artifact) => onOpenArtifact({ id: artifact.id, name: artifact.name })}
										oncopy={copyTextToClipboard}
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
				{:else if row?.kind === "message" && row.message.role === "command-result"}
					{@const message = row.message}
					<article
						data-index={virtualRow.index}
						use:measureTranscriptRow
						class="message-row virtual-row tool-row"
					>
						<ToolCallCard
							toolCall={projectRawToolCall({
								id: message.toolCallId,
								name: message.toolName,
								status: message.isError ? "failed" : "done",
								result: toolResultPreview(message),
								isError: message.isError,
							})}
							onopen={(artifact) => onOpenArtifact({ id: artifact.id, name: artifact.name })}
							oncopy={copyTextToClipboard}
						/>
					</article>
				{/if}
			{/each}
		</div>
		</div>
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

	.chat-thread-virtual-block {
		display: flex;
		flex-direction: column;
		width: 100%;
		will-change: transform;
	}

	.message-row {
		display: flex;
		width: 100%;
	}

	.virtual-row {
		flex: 0 0 auto;
	}

	.user-row {
		justify-content: flex-end;
	}

	.assistant-row,
	.tool-row,
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

	.product-event-block {
		display: grid;
		gap: 0.18rem;
		width: 100%;
		padding: 0.72rem 0.85rem;
		border: 1px solid var(--ui-border-soft);
		border-left: 3px solid var(--ui-accent);
		border-radius: 8px;
		background: var(--ui-surface-subtle);
		color: var(--ui-text-secondary);
		font-size: var(--text-sm);
		line-height: 1.4;
	}

	.product-event-block strong {
		color: var(--ui-text);
		font-size: var(--text-sm);
	}

	.product-event-block time {
		color: var(--ui-text-tertiary);
		font-size: var(--text-xs);
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

	.user-snippet-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.42rem;
		margin-top: 0.72rem;
	}

	.user-snippet-chip {
		max-width: min(100%, 24rem);
		border: 1px solid color-mix(in oklab, var(--ui-border-accent) 48%, var(--ui-border-soft));
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-accent-soft) 26%, var(--ui-code));
		color: var(--ui-text-secondary);
		font-size: var(--text-xs);
	}

	.user-snippet-chip summary {
		display: flex;
		align-items: center;
		gap: 0.34rem;
		min-width: 0;
		padding: 0.28rem 0.46rem;
		cursor: pointer;
	}

	.user-snippet-chip strong {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ui-text-primary);
		font-weight: 650;
	}

	.user-snippet-chip summary span {
		flex: 0 0 auto;
		padding: 0.03rem 0.24rem;
		border-radius: var(--ui-radius-xs);
		background: color-mix(in oklab, var(--ui-surface-raised) 80%, transparent);
		font-family: var(--font-mono);
		text-transform: uppercase;
	}

	.user-snippet-detail {
		display: grid;
		gap: 0.34rem;
		padding: 0 0.46rem 0.46rem;
	}

	.user-snippet-detail p {
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		color: var(--ui-text-tertiary);
	}

	.user-snippet-detail pre {
		max-height: 10rem;
		margin: 0;
		overflow: auto;
		white-space: pre-wrap;
		font-family: var(--font-mono);
		color: var(--ui-text-secondary);
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
		gap: 0.18rem;
		min-width: 0;
		color: var(--ui-text-tertiary);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		line-height: inherit;
		white-space: nowrap;
	}

	.assistant-turn-duration-icon {
		flex: 0 0 auto;
		color: currentColor;
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
		cursor: default;
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
