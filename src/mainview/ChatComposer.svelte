<script lang="ts">
	import FileIcon from "@lucide/svelte/icons/file";
	import FileTextIcon from "@lucide/svelte/icons/file-text";
	import FolderIcon from "@lucide/svelte/icons/folder";
	import ImageIcon from "@lucide/svelte/icons/image";
	import PaperclipIcon from "@lucide/svelte/icons/paperclip";
	import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
	import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
	import ClockIcon from "@lucide/svelte/icons/clock";
	import SquareIcon from "@lucide/svelte/icons/square";
	import XIcon from "@lucide/svelte/icons/x";
	import { onMount, tick } from "svelte";
	import type { Model } from "@mariozechner/pi-ai";
	import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
	import type { ContextBudget } from "../shared/context-budget";
	import {
		createPromptHistoryNavigationState,
		navigatePromptHistory,
		shouldActivatePromptHistoryNavigation,
		type PromptHistoryDirection,
		type PromptHistoryEntry,
		type PromptHistoryNavigationState,
	} from "./prompt-history";
	import {
		caretAfterSnippetMentionToken,
		commitTypedSnippetMention,
		getActiveMentionQuery,
		expandComposerSnippetMention,
		isActiveMentionSelected,
		nextSnippetArgumentKeyboardTarget,
		removeComposerSnippetMentionToken,
		searchComposerMentionResults,
		selectMentionPath,
		selectMentionSnippet,
		serializeComposerDraft,
		type ComposerMentionPickerResult,
		type WorkspacePathIndexEntry,
	} from "./composer-mentions";
	import ContextBudgetBar from "./ContextBudgetBar.svelte";
	import ExtensionUsageControl from "./ExtensionUsageControl.svelte";
	import TextArea from "./ui/TextArea.svelte";
	import Tooltip from "./ui/Tooltip.svelte";
	import CompactSelect from "./ui/CompactSelect.svelte";
	import CompactCombobox, { type CompactComboboxOption } from "./ui/CompactCombobox.svelte";
	import { formatWorkingElapsed, formatWorkingElapsedTooltip } from "./working-timer";
	import QueuedMessagesStrip from "./QueuedMessagesStrip.svelte";
	import type { QueuedPrompt } from "./chat-runtime";
	import type { AgentContextActor, ExtensionUsageControlItem } from "./agents-pane-extension-usage";
	import type { ExtensionUsageState } from "../shared/extensions";
	import type {
		ComposerAttachment,
		ComposerDraft,
		PromptClientSubmissionMetadata,
	} from "../shared/workspace-contract";
	import type {
		ComposerSnippetMention,
		SentSnippetProvenance,
		SnippetsReadModel,
	} from "../shared/snippets";

	export type ComposerSubmit = {
		text: string;
		attachments: ComposerAttachment[];
		snippetMentions?: ComposerSnippetMention[];
		snippetProvenance?: SentSnippetProvenance[];
		editMessageTimestamp?: string | number;
		telemetryCorrelationId?: string;
		clientSubmission?: PromptClientSubmissionMetadata;
	};

	export type ComposerSubmitTelemetryEvent = {
		eventName:
			| "composer.submit.blocked"
			| "composer.submit.accepted"
			| "composer.submit.serialized"
			| "composer.submit.sent"
			| "composer.submit.rejected"
			| "composer.submit.failed";
		correlationId: string;
		level: "debug" | "info" | "warn" | "error";
		message: string;
		details: Record<string, unknown>;
		clientSubmission?: PromptClientSubmissionMetadata;
		error?: {
			name?: string;
			message: string;
			stack?: string;
		};
	};

	export type ComposerEditDraft = {
		messageTimestamp: string | number;
		text: string;
	};

	export type ComposerModelOption = CompactComboboxOption & {
		model: Model<any>;
		supportedThinkingLevels: ThinkingLevel[];
	};

	type Props = {
		currentModel: Model<any> | null;
		thinkingLevel: ThinkingLevel;
		isStreaming: boolean;
		activeTurnStartedAt: string | null;
		promptHistory: PromptHistoryEntry[];
		errorMessage?: string;
		contextBudget?: ContextBudget | null;
		queuedMessages?: QueuedPrompt[];
		composerDraft?: ComposerDraft;
		draftStorageKey?: string;
		editDraft?: ComposerEditDraft | null;
		sessionName?: string;
		targetLabel?: string;
		worktreeLabel?: string;
		onOpenModelPicker: () => void;
		onListModels: () => Promise<ComposerModelOption[]>;
		onModelChange: (model: Model<any>) => void;
		onSend: (input: ComposerSubmit) => Promise<boolean> | boolean;
		onStop: () => Promise<void> | void;
		onTelemetry?: (event: ComposerSubmitTelemetryEvent) => void;
		onDraftChange?: (draft: {
			text: string;
			attachments: ComposerAttachment[];
			snippetMentions?: ComposerSnippetMention[];
		}) => void;
		onBufferChange?: (draft: {
			text: string;
			attachments: ComposerAttachment[];
			snippetMentions?: ComposerSnippetMention[];
		}) => void;
		onEditQueuedMessage?: (promptId: string) => Promise<string | null> | string | null;
		onDeleteQueuedMessage?: (promptId: string) => void;
		onSteerQueuedMessage?: (promptId: string) => void;
		onReorderQueuedMessage?: (promptId: string, beforePromptId: string | null) => void;
		onCancelEditMessage?: () => void;
		onThinkingChange: (level: ThinkingLevel) => void;
		extensionActor?: AgentContextActor;
		extensionUsageItems?: ExtensionUsageControlItem[];
		onExtensionUsageChange?: (extensionId: string, state: ExtensionUsageState) => void | Promise<void>;
		onOpenExtension?: (extensionId: string) => void;
		listWorkspacePaths: (options?: { refresh?: boolean }) => Promise<WorkspacePathIndexEntry[]>;
		listSnippets: () => Promise<SnippetsReadModel>;
		pickWorkspaceAttachments: () => Promise<ComposerAttachment[]>;
		importComposerAttachments: (files: File[]) => Promise<ComposerAttachment[]>;
	};

	let {
		currentModel,
		thinkingLevel,
		isStreaming,
		activeTurnStartedAt,
		promptHistory,
		errorMessage,
		contextBudget,
		queuedMessages = [],
		composerDraft = { text: "", attachments: [], updatedAt: null },
		draftStorageKey = "composer",
		editDraft = null,
		sessionName = "Current session",
		targetLabel = "orchestrator",
		worktreeLabel = "worktree",
		onOpenModelPicker,
		onListModels,
		onModelChange,
		onSend,
		onStop,
		onTelemetry = () => {},
		onDraftChange = () => {},
		onBufferChange = () => {},
		onEditQueuedMessage = () => {},
		onDeleteQueuedMessage = () => {},
		onSteerQueuedMessage = () => {},
		onReorderQueuedMessage = () => {},
		onCancelEditMessage = () => {},
		onThinkingChange,
		extensionActor = "orchestrator",
		extensionUsageItems = [],
		onExtensionUsageChange = () => {},
		onOpenExtension = () => {},
		listWorkspacePaths,
		listSnippets,
		pickWorkspaceAttachments,
		importComposerAttachments,
	}: Props = $props();

	let draft = $state("");
	let isSubmitting = $state(false);
	let isStopping = $state(false);
	let showThinkingMenu = $state(false);
	let showModelMenu = $state(false);
	let modelOptions = $state<CompactComboboxOption[]>([]);
	let modelOptionModels = $state(new Map<string, Model<any>>());
	let modelOptionThinkingLevels = $state(new Map<string, ThinkingLevel[]>());
	let draftElement = $state<HTMLTextAreaElement | null>(null);
	let historyNavigation = $state<PromptHistoryNavigationState>(createPromptHistoryNavigationState());
	let mentionRoot = $state<HTMLDivElement | null>(null);
	let workspacePaths = $state<WorkspacePathIndexEntry[]>([]);
	let workspacePathsLoaded = $state(false);
	let snippets = $state<SnippetsReadModel | null>(null);
	let snippetsLoaded = $state(false);
	let mentionLoading = $state(false);
	let mentionError = $state<string | null>(null);
	let pendingTypedSnippetCommit = $state(false);
	let attachments = $state<ComposerAttachment[]>([]);
	let snippetMentions = $state<ComposerSnippetMention[]>([]);
	let isDragActive = $state(false);
	let workingTimerNow = $state(Date.now());
	let activeMentionIndex = $state(0);
	let caretPosition = $state(0);
	let dismissedMentionQueryKey = $state<string | null>(null);
	let workspacePathTargetKey = $state("");
	let loadedEditDraftKey = $state<string | null>(null);
	let loadedComposerDraftKey = $state<string | null>(null);
	let lastPersistedDraftPayloadKey = $state<string | null>(null);
	let draftPersistenceReady = $state(false);
	let submitTelemetrySequence = 0;
	const modelValue = $derived(currentModel ? `${currentModel.provider}:${currentModel.id}` : "no-surface");
	const availableThinkingLevels = $derived.by(() => {
		if (!currentModel) return [thinkingLevel];
		return modelOptionThinkingLevels.get(modelValue) ?? [thinkingLevel];
	});
	const thinkingOptions = $derived(
		availableThinkingLevels.map((level) => ({ value: level, label: level })),
	);

	function cloneComposerAttachments(input: readonly ComposerAttachment[]): ComposerAttachment[] {
		return input.map((attachment) => ({ ...attachment }));
	}

	function cloneSnippetMentions(input: readonly ComposerSnippetMention[]): ComposerSnippetMention[] {
		return input.map((mention) => ({
			...mention,
			arguments: [...mention.arguments],
			metadata: { ...mention.metadata },
		}));
	}

	function createSubmitTelemetryCorrelationId(): string {
		submitTelemetrySequence += 1;
		return `composer-submit-${Date.now().toString(36)}-${submitTelemetrySequence}`;
	}

	function normalizeTelemetryError(error: unknown): ComposerSubmitTelemetryEvent["error"] {
		if (error instanceof Error) {
			return {
				name: error.name || undefined,
				message: error.message || "Unknown error",
				stack: error.stack,
			};
		}
		return { message: typeof error === "string" ? error : "Unknown error" };
	}

	function attachmentKindCounts(input: readonly ComposerAttachment[]): Record<string, number> {
		return input.reduce<Record<string, number>>((counts, attachment) => {
			counts[attachment.kind] = (counts[attachment.kind] ?? 0) + 1;
			return counts;
		}, {});
	}

	function composerSubmitTelemetryDetails(extra: Record<string, unknown> = {}): Record<string, unknown> {
		return {
			surfacePiSessionId: draftStorageKey,
			draftLength: draft.length,
			trimmedDraftLength: draft.trim().length,
			attachmentCount: attachments.length,
			attachmentKindCounts: attachmentKindCounts(attachments),
			snippetMentionCount: snippetMentions.length,
			isEdit: editDraft?.messageTimestamp !== undefined,
			canSubmit,
			isSubmitting,
			...extra,
		};
	}

	function createSubmissionMetadata(input: {
		correlationId: string;
		text: string;
		visibleDraft: string;
		attachments: readonly ComposerAttachment[];
		snippetMentions: readonly ComposerSnippetMention[];
		snippetProvenance: readonly SentSnippetProvenance[];
		isEdit: boolean;
	}): PromptClientSubmissionMetadata {
		return {
			submissionId: input.correlationId,
			correlationId: input.correlationId,
			clientRequestId: input.correlationId,
			source: "surface-composer",
			submittedAt: new Date().toISOString(),
			sequence: submitTelemetrySequence,
			draftLength: input.visibleDraft.length,
			trimmedDraftLength: input.visibleDraft.trim().length,
			serializedTextLength: input.text.length,
			attachmentCount: input.attachments.length,
			snippetMentionCount: input.snippetMentions.length,
			snippetProvenanceCount: input.snippetProvenance.length,
			isEdit: input.isEdit,
		};
	}

	function submissionTelemetryDetails(
		clientSubmission: PromptClientSubmissionMetadata,
		extra: Record<string, unknown> = {},
	): Record<string, unknown> {
		return {
			surfacePiSessionId: draftStorageKey,
			draftLength: clientSubmission.draftLength ?? 0,
			trimmedDraftLength: clientSubmission.trimmedDraftLength ?? 0,
			serializedTextLength: clientSubmission.serializedTextLength ?? 0,
			attachmentCount: clientSubmission.attachmentCount ?? 0,
			snippetMentionCount: clientSubmission.snippetMentionCount ?? 0,
			snippetProvenanceCount: clientSubmission.snippetProvenanceCount ?? 0,
			isEdit: clientSubmission.isEdit ?? false,
			...extra,
		};
	}

	function emitSubmitTelemetry(event: ComposerSubmitTelemetryEvent): void {
		onTelemetry(event);
	}
	const visibleModelOptions = $derived.by<CompactComboboxOption[]>(() => {
		if (!currentModel) return [{ value: "no-surface", label: "No surface", disabled: true }];
		const currentValue = modelValue;
		if (modelOptions.some((option) => option.value === currentValue)) return modelOptions;
		return [{ value: currentValue, label: currentModel.name, triggerLabel: currentModel.name }, ...modelOptions];
	});
	const mentionQuery = $derived(getActiveMentionQuery(draft, caretPosition));
	const mentionQueryKey = $derived(mentionQuery ? `${mentionQuery.start}:${mentionQuery.query}` : null);
	const activeMentionIsSelected = $derived(
		isActiveMentionSelected({ value: draft, query: mentionQuery, paths: workspacePaths }),
	);
	const mentionResults = $derived<ComposerMentionPickerResult[]>(
		mentionQuery && (workspacePathsLoaded || snippetsLoaded)
			? searchComposerMentionResults({
					paths: workspacePathsLoaded ? workspacePaths : [],
					snippets: snippets?.snippets ?? [],
					query: mentionQuery.query,
					limit: 10,
				})
			: [],
	);
	const hasImageAttachments = $derived(attachments.some((attachment) => attachment.kind === "image"));
	const modelSupportsImages = $derived(Boolean((currentModel as unknown as { input?: string[] } | null)?.input?.includes("image")));
	const showImageModelWarning = $derived(Boolean(hasImageAttachments && currentModel && !modelSupportsImages));
	const canSubmit = $derived(Boolean(draft.trim() || attachments.length > 0 || snippetMentions.length > 0));
	const contextBudgetTooltip = $derived(contextBudget ? "" : "Context unavailable");
	const contextBudgetTooltipDetails = $derived(
		contextBudget ? buildContextBudgetTooltipDetails(contextBudget) : [],
	);
	const workingElapsedLabel = $derived(formatWorkingElapsed(activeTurnStartedAt, workingTimerNow));
	const workingElapsedTooltip = $derived(
		formatWorkingElapsedTooltip(activeTurnStartedAt, workingTimerNow),
	);
	const showMentionPicker = $derived(
		Boolean(
			mentionQuery &&
				!activeMentionIsSelected &&
				mentionQueryKey !== dismissedMentionQueryKey &&
				(mentionLoading || mentionError || workspacePathsLoaded || mentionResults.length > 0),
		),
	);

	$effect(() => {
		if (!isStreaming) return;
		workingTimerNow = Date.now();
		const timer = window.setInterval(() => {
			workingTimerNow = Date.now();
		}, 1000);
		return () => window.clearInterval(timer);
	});

	$effect(() => {
		if (!isStreaming) {
			isStopping = false;
		}
	});

	$effect(() => {
		const targetKey = `${draftStorageKey}\u0000${targetLabel}\u0000${worktreeLabel}`;
		if (targetKey !== workspacePathTargetKey) {
			workspacePathTargetKey = targetKey;
			workspacePaths = [];
			workspacePathsLoaded = false;
			snippets = null;
			snippetsLoaded = false;
			mentionLoading = false;
			mentionError = null;
			activeMentionIndex = 0;
			dismissedMentionQueryKey = null;
		}
		void tick().then(() => {
			draftElement?.focus();
		});
	});

	$effect(() => {
		void draft;
		const nextMentions = snippetMentions.filter((mention) => draft.includes(mention.token));
		if (nextMentions.length !== snippetMentions.length) {
			snippetMentions = nextMentions;
		}
	});

	$effect(() => {
		void draft;
		void tick().then(syncDraftTextareaHeight);
	});

	$effect(() => {
		void draft;
		void attachments;
		void snippetMentions;
		onBufferChange({
			text: draft,
			attachments: cloneComposerAttachments(attachments),
			snippetMentions: cloneSnippetMentions(snippetMentions),
		});
	});

	$effect(() => {
		if (editDraft) return;
		const storageKey = draftStorageKey;
		const updatedAt = composerDraft.updatedAt;
		const attachmentsKey = JSON.stringify(composerDraft.attachments);
		const snippetMentionsKey = JSON.stringify(composerDraft.snippetMentions ?? []);
		const incomingKey = `${storageKey}\u0000${updatedAt ?? ""}\u0000${composerDraft.text}\u0000${attachmentsKey}\u0000${snippetMentionsKey}`;
		if (incomingKey === loadedComposerDraftKey) return;
		loadedComposerDraftKey = incomingKey;
		lastPersistedDraftPayloadKey = `${composerDraft.text}\u0000${attachmentsKey}\u0000${snippetMentionsKey}`;
		if (
			draft === composerDraft.text &&
			JSON.stringify(attachments) === attachmentsKey &&
			JSON.stringify(snippetMentions) === snippetMentionsKey
		) {
			draftPersistenceReady = true;
			return;
		}
		draft = composerDraft.text;
		attachments = cloneComposerAttachments(composerDraft.attachments);
		snippetMentions = cloneSnippetMentions(composerDraft.snippetMentions ?? []);
		resetHistoryNavigation();
		draftPersistenceReady = true;
		void tick().then(() => moveCaretToDraftEnd(composerDraft.text));
	});

	$effect(() => {
		if (editDraft) return;
		if (!draftPersistenceReady) return;
		void draftStorageKey;
		void draft;
		void attachments;
		void snippetMentions;
		const payloadKey = `${draft}\u0000${JSON.stringify(attachments)}\u0000${JSON.stringify(snippetMentions)}`;
		if (payloadKey === lastPersistedDraftPayloadKey) return;
		lastPersistedDraftPayloadKey = payloadKey;
		onDraftChange({
			text: draft,
			attachments: cloneComposerAttachments(attachments),
			snippetMentions: cloneSnippetMentions(snippetMentions),
		});
	});

	$effect(() => {
		const editKey = editDraft ? String(editDraft.messageTimestamp) : null;
		if (!editDraft || editKey === loadedEditDraftKey) return;
		loadedEditDraftKey = editKey;
		draft = editDraft.text;
		attachments = [];
		snippetMentions = [];
		resetHistoryNavigation();
		void tick().then(() => moveCaretToDraftEnd(editDraft.text));
	});

	$effect(() => {
		if (mentionResults.length === 0) {
			activeMentionIndex = 0;
			return;
		}
		if (activeMentionIndex >= mentionResults.length) {
			activeMentionIndex = mentionResults.length - 1;
		}
	});

	onMount(() => {
		syncDraftTextareaHeight();
		void loadModelOptions();

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (mentionRoot?.contains(target) || draftElement?.contains(target)) return;
			closeMentionPicker();
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				closeMentionPicker();
			}
		};

		window.addEventListener("pointerdown", handlePointerDown);
		window.addEventListener("keydown", handleKeyDown);

		return () => {
			window.removeEventListener("pointerdown", handlePointerDown);
			window.removeEventListener("keydown", handleKeyDown);
		};
	});

	async function restoreDraftBuffer(nextDraft: string) {
		if (draft !== "") return;
		draft = nextDraft;
		await tick();
		moveCaretToDraftEnd(nextDraft);
	}

	async function editQueuedMessage(promptId: string) {
		const text = await onEditQueuedMessage(promptId);
		if (text) {
			await restoreDraftBuffer(text);
		}
	}

	function resetHistoryNavigation() {
		historyNavigation = createPromptHistoryNavigationState();
	}

	function moveCaretToDraftEnd(value: string) {
		draftElement?.focus();
		draftElement?.setSelectionRange(value.length, value.length);
		caretPosition = value.length;
		syncDraftTextareaHeight();
	}

	function syncCaretFromTextarea(target: EventTarget | null) {
		if (!(target instanceof HTMLTextAreaElement)) return;
		let selectionStart = target.selectionStart;
		let selectionEnd = target.selectionEnd;
		if (selectionStart === 0 && selectionEnd === 0) {
			const endMentionQuery = getActiveMentionQuery(target.value, target.value.length);
			if (endMentionQuery) {
				selectionStart = target.value.length;
				selectionEnd = target.value.length;
				target.setSelectionRange(selectionStart, selectionEnd);
			}
		}
		caretPosition = selectionStart;
		if (getActiveMentionQuery(target.value, selectionStart, selectionEnd)) {
			void ensureMentionSources();
		}
	}

	function syncDraftTextareaHeight() {
		if (!draftElement) return;

		draftElement.style.height = "auto";
		const maxHeight = Number.parseFloat(getComputedStyle(draftElement).maxHeight);
		const resolvedMaxHeight = Number.isFinite(maxHeight) ? maxHeight : Number.POSITIVE_INFINITY;
		const nextHeight = Math.min(draftElement.scrollHeight, resolvedMaxHeight);
		draftElement.style.height = `${nextHeight}px`;
		draftElement.style.overflowY = draftElement.scrollHeight > resolvedMaxHeight ? "auto" : "hidden";
	}

	function handleDraftInput(event: Event) {
		const target = event.currentTarget;
		syncCaretFromTextarea(target);
		commitTypedSnippetMentionFromTextarea(target);
		syncDraftTextareaHeight();
	}

	async function commitTypedSnippetMentionFromTextarea(target: EventTarget | null) {
		if (!(target instanceof HTMLTextAreaElement)) return;
		if (!/\s$/.test(target.value.slice(0, target.selectionStart))) return;
		if (!snippetsLoaded || !snippets) {
			if (mentionLoading) {
				pendingTypedSnippetCommit = true;
				return;
			}
			await ensureMentionSources();
		}
		if (!snippetsLoaded || !snippets) return;
		const committed = commitTypedSnippetMention({
			value: target.value,
			caret: target.selectionStart,
			snippets: snippets.snippets,
			existingMentions: snippetMentions,
		});
		if (!committed) return;
		draft = committed.draft;
		snippetMentions = [...snippetMentions, committed.mention];
		await tick();
		caretPosition = committed.caret;
		if (committed.mention.arguments.length > 0) {
			await focusSnippetArgument(committed.mention.id, 0);
		} else {
			focusComposerAt(committed.caret);
		}
	}

	async function scrollActiveMentionIntoView() {
		await tick();
		const activeOption = mentionRoot?.querySelector<HTMLElement>(".mention-option.active");
		activeOption?.scrollIntoView({ block: "nearest" });
	}

	async function ensureMentionSources() {
		if ((workspacePathsLoaded && snippetsLoaded) || mentionLoading) return;
		mentionLoading = true;
		mentionError = null;
		try {
			const [nextWorkspacePaths, nextSnippets] = await Promise.all([
				workspacePathsLoaded ? Promise.resolve(workspacePaths) : listWorkspacePaths({ refresh: true }),
				snippetsLoaded ? Promise.resolve(snippets) : listSnippets(),
			]);
			workspacePaths = nextWorkspacePaths;
			workspacePathsLoaded = true;
			snippets = nextSnippets;
			snippetsLoaded = true;
		} catch (error) {
			mentionError = error instanceof Error ? error.message : "Mentions unavailable.";
		} finally {
			syncCaretFromTextarea(draftElement);
			mentionLoading = false;
			if (pendingTypedSnippetCommit && snippetsLoaded && snippets) {
				pendingTypedSnippetCommit = false;
				void tick().then(() => commitTypedSnippetMentionFromTextarea(draftElement));
			}
		}
	}

	function closeMentionPicker() {
		activeMentionIndex = 0;
		dismissedMentionQueryKey = mentionQueryKey;
	}

	async function chooseMention(result: ComposerMentionPickerResult) {
		if (!mentionQuery) return;
		if (result.type === "snippet") {
			const selection = selectMentionSnippet(draft, mentionQuery, result.snippet, snippetMentions);
			draft = selection.draft;
			snippetMentions = [...snippetMentions, selection.mention];
			activeMentionIndex = 0;
			dismissedMentionQueryKey = `${mentionQuery.start}:${selection.mention.token}`;
			await tick();
			caretPosition = selection.caret;
			if (selection.mention.arguments.length > 0) {
				await focusSnippetArgument(selection.mention.id, 0);
			} else {
				focusComposerAt(selection.caret);
			}
			return;
		}
		const selection = selectMentionPath(draft, mentionQuery, result);
		draft = selection.draft;
		activeMentionIndex = 0;
		dismissedMentionQueryKey = `${mentionQuery.start}:${result.workspaceRelativePath}`;
		await tick();
		draftElement?.focus();
		draftElement?.setSelectionRange(selection.caret, selection.caret);
		caretPosition = selection.caret;
	}

	async function focusSnippetArgument(mentionId: string, argumentIndex: number) {
		await tick();
		document
			.querySelector<HTMLInputElement>(`[data-snippet-argument="${mentionId}:${argumentIndex}"]`)
			?.focus();
	}

	function focusComposerAt(caret: number) {
		draftElement?.focus();
		draftElement?.setSelectionRange(caret, caret);
		caretPosition = caret;
	}

	function focusComposerAfterSnippetArguments(mention: ComposerSnippetMention) {
		focusComposerAt(caretAfterSnippetMentionToken(draft, mention));
	}

	function shouldFocusComposerFromFrame(target: EventTarget | null) {
		if (!(target instanceof Element)) return;
		if (target.closest(".composer-row-actions")) return;
		if (target.closest("button, input, select, textarea, a, [role='button']")) return;
		return true;
	}

	function prepareComposerFrameFocus(event: PointerEvent) {
		if (!shouldFocusComposerFromFrame(event.target)) return;
		event.preventDefault();
	}

	function focusComposerFromFrame(event: PointerEvent) {
		if (!shouldFocusComposerFromFrame(event.target)) return;
		event.preventDefault();
		window.requestAnimationFrame(() => moveCaretToDraftEnd(draft));
	}

	async function expandSnippetMention(mention: ComposerSnippetMention) {
		const selection = expandComposerSnippetMention(draft, mention);
		draft = selection.draft;
		snippetMentions = snippetMentions.filter((candidate) => candidate.id !== mention.id);
		await tick();
		draftElement?.focus();
		draftElement?.setSelectionRange(selection.caret, selection.caret);
		caretPosition = selection.caret;
	}

	async function removeSnippetMention(mention: ComposerSnippetMention) {
		const selection = removeComposerSnippetMentionToken(draft, mention);
		draft = selection.draft;
		snippetMentions = snippetMentions.filter((candidate) => candidate.id !== mention.id);
		await tick();
		draftElement?.focus();
		draftElement?.setSelectionRange(selection.caret, selection.caret);
		caretPosition = selection.caret;
	}

	function updateSnippetMentionArgument(mentionId: string, argumentIndex: number, value: string) {
		snippetMentions = snippetMentions.map((mention) =>
			mention.id === mentionId
				? {
						...mention,
						arguments: mention.arguments.map((argument, index) =>
							index === argumentIndex ? value : argument,
						),
					}
				: mention,
		);
	}

	async function handleSnippetArgumentKeydown(
		event: KeyboardEvent,
		mentionId: string,
		argumentIndex: number,
		argumentCount: number,
	) {
		const target = nextSnippetArgumentKeyboardTarget({
			key: event.key,
			argumentIndex,
			argumentCount,
			shiftKey: event.shiftKey,
			altKey: event.altKey,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
		});
		if (!target) return;
		event.preventDefault();
		await tick();
		if (target.kind === "composer") {
			const mention = snippetMentions.find((candidate) => candidate.id === mentionId);
			if (mention) {
				focusComposerAfterSnippetArguments(mention);
			} else {
				draftElement?.focus();
			}
			return;
		}
		await focusSnippetArgument(mentionId, target.argumentIndex);
	}

	async function applyPromptHistoryNavigation(direction: PromptHistoryDirection) {
		const navigation = navigatePromptHistory(promptHistory, historyNavigation, draft, direction);
		if (!navigation.changed) return;

		historyNavigation = navigation.nextState;
		draft = navigation.nextDraft;
		await tick();
		moveCaretToDraftEnd(navigation.nextDraft);
	}

	async function submit() {
		if (!canSubmit || isSubmitting) {
			const correlationId = createSubmitTelemetryCorrelationId();
			emitSubmitTelemetry({
				eventName: "composer.submit.blocked",
				correlationId,
				level: "debug",
				message: "Composer submit blocked before send.",
				details: composerSubmitTelemetryDetails({
					reason: !canSubmit ? "empty-draft" : "already-submitting",
				}),
			});
			return;
		}
		const correlationId = createSubmitTelemetryCorrelationId();
		emitSubmitTelemetry({
			eventName: "composer.submit.accepted",
			correlationId,
			level: "debug",
			message: "Composer submit accepted.",
			details: composerSubmitTelemetryDetails(),
		});
		const editingMessageTimestamp = editDraft?.messageTimestamp;
		const serialized = serializeComposerDraft(draft, snippetMentions);
		const nextDraft = serialized.text;
		const nextVisibleDraft = draft;
		const nextAttachments = attachments;
		const nextSnippetMentions = snippetMentions;
		const clientSubmission = createSubmissionMetadata({
			correlationId,
			text: nextDraft,
			visibleDraft: nextVisibleDraft,
			attachments: nextAttachments,
			snippetMentions: nextSnippetMentions,
			snippetProvenance: serialized.snippetProvenance,
			isEdit: editingMessageTimestamp !== undefined,
		});
		emitSubmitTelemetry({
			eventName: "composer.submit.serialized",
			correlationId,
			level: "debug",
			message: "Composer submit serialized draft.",
			clientSubmission,
			details: submissionTelemetryDetails(clientSubmission, {
				serializedTrimmedTextLength: nextDraft.trim().length,
				submittedAttachmentCount: nextAttachments.length,
				submittedAttachmentKindCounts: attachmentKindCounts(nextAttachments),
				submittedSnippetMentionCount: nextSnippetMentions.length,
			}),
		});
		isSubmitting = true;

		try {
			const sent = await onSend({
				text: nextDraft,
				attachments: nextAttachments,
				snippetMentions: nextSnippetMentions,
				snippetProvenance: serialized.snippetProvenance,
				editMessageTimestamp: editingMessageTimestamp,
				telemetryCorrelationId: correlationId,
				clientSubmission,
			});
			if (sent) {
				draft = "";
				attachments = [];
				snippetMentions = [];
				emitSubmitTelemetry({
					eventName: "composer.submit.sent",
					correlationId,
					level: "info",
					message: "Composer submit completed.",
					clientSubmission,
					details: submissionTelemetryDetails(clientSubmission),
				});
				resetHistoryNavigation();
				if (editingMessageTimestamp !== undefined) {
					loadedEditDraftKey = null;
					onCancelEditMessage();
				}
			} else {
				emitSubmitTelemetry({
					eventName: "composer.submit.rejected",
					correlationId,
					level: "warn",
					message: "Composer submit was rejected by the surface host.",
					clientSubmission,
					details: submissionTelemetryDetails(clientSubmission),
				});
			}
		} catch (error) {
			emitSubmitTelemetry({
				eventName: "composer.submit.failed",
				correlationId,
				level: "error",
				message: "Composer submit failed before the draft could be handed off.",
				clientSubmission,
				details: submissionTelemetryDetails(clientSubmission),
				error: normalizeTelemetryError(error),
			});
		} finally {
			isSubmitting = false;
		}
	}

	async function stopStreaming() {
		if (!isStreaming || isStopping) return;
		isStopping = true;
		try {
			await onStop();
		} finally {
			isStopping = false;
			draftElement?.focus();
		}
	}

	function cancelEditMessage() {
		loadedEditDraftKey = null;
		draft = "";
		attachments = [];
		snippetMentions = [];
		onCancelEditMessage();
		draftElement?.focus();
	}

	function handleKeydown(event: KeyboardEvent) {
		const target = event.currentTarget;
		if (showMentionPicker && mentionQuery) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const direction = event.key === "ArrowDown" ? 1 : -1;
				activeMentionIndex =
					(mentionResults.length + activeMentionIndex + direction) % Math.max(mentionResults.length, 1);
				void scrollActiveMentionIntoView();
				return;
			}
			if ((event.key === "Enter" || event.key === "Tab") && mentionResults[activeMentionIndex]) {
				event.preventDefault();
				void chooseMention(mentionResults[activeMentionIndex]);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				closeMentionPicker();
				return;
			}
		}

		if (
			target instanceof HTMLTextAreaElement &&
			event.key === " " &&
			!event.shiftKey &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			snippetsLoaded &&
			snippets
		) {
			const valueWithSpace = `${target.value.slice(0, target.selectionStart)} ${target.value.slice(target.selectionEnd)}`;
			const caret = target.selectionStart + 1;
			const committed = commitTypedSnippetMention({
				value: valueWithSpace,
				caret,
				snippets: snippets.snippets,
				existingMentions: snippetMentions,
			});
			if (committed) {
				event.preventDefault();
				draft = committed.draft;
				snippetMentions = [...snippetMentions, committed.mention];
				caretPosition = committed.caret;
				void tick().then(() => {
					if (committed.mention.arguments.length > 0) {
						void focusSnippetArgument(committed.mention.id, 0);
					} else {
						focusComposerAt(committed.caret);
					}
				});
				return;
			}
		}

		if (
			target instanceof HTMLTextAreaElement &&
			!event.shiftKey &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			(event.key === "ArrowUp" || event.key === "ArrowDown")
		) {
			const direction: PromptHistoryDirection = event.key === "ArrowUp" ? "older" : "newer";
			const shouldNavigateHistory = shouldActivatePromptHistoryNavigation({
				direction,
				value: target.value,
				selectionStart: target.selectionStart,
				selectionEnd: target.selectionEnd,
				higherPriorityUiActive: showThinkingMenu || showMentionPicker,
			});

			if (shouldNavigateHistory) {
				event.preventDefault();
				void applyPromptHistoryNavigation(direction);
				return;
			}
		}

		if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
		event.preventDefault();
		void submit();
	}

	async function attachPickedWorkspaceFiles() {
		try {
			const picked = await pickWorkspaceAttachments();
			if (picked.length === 0) {
				draftElement?.focus();
				return;
			}

			addAttachments(picked);
			await tick();
			draftElement?.focus();
		} catch {
			draftElement?.focus();
		}
	}

	function addAttachments(nextAttachments: ComposerAttachment[]) {
		const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
		for (const attachment of nextAttachments) {
			byId.set(attachment.id, attachment);
		}
		attachments = [...byId.values()];
	}

	function removeAttachment(attachmentId: string) {
		attachments = attachments.filter((attachment) => attachment.id !== attachmentId);
		draftElement?.focus();
	}

	async function importFiles(files: File[]) {
		const importable = files.filter((file) => file.size > 0 || file.type);
		if (importable.length === 0) return;
		addAttachments(await importComposerAttachments(importable));
		await tick();
		draftElement?.focus();
	}

	function clipboardFiles(event: ClipboardEvent): File[] {
		const files = Array.from(event.clipboardData?.files ?? []);
		if (files.length > 0) return files;
		return Array.from(event.clipboardData?.items ?? [])
			.filter((item) => item.kind === "file")
			.map((item) => item.getAsFile())
			.filter((file): file is File => Boolean(file));
	}

	function handlePaste(event: ClipboardEvent) {
		const files = clipboardFiles(event);
		if (files.length === 0) return;
		event.preventDefault();
		void importFiles(files);
	}

	function handleDragOver(event: DragEvent) {
		if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
		event.preventDefault();
		isDragActive = true;
	}

	function handleDragLeave(event: DragEvent) {
		if (event.currentTarget !== event.target) return;
		isDragActive = false;
	}

	function handleDrop(event: DragEvent) {
		const files = Array.from(event.dataTransfer?.files ?? []);
		if (files.length === 0) return;
		event.preventDefault();
		isDragActive = false;
		void importFiles(files);
	}

	function attachmentLabel(attachment: ComposerAttachment): string {
		return attachment.workspaceRelativePath ?? attachment.path;
	}

	async function loadModelOptions() {
		const options = await onListModels();
		modelOptions = options;
		modelOptionModels = new Map(options.map((option) => [option.value, option.model]));
		modelOptionThinkingLevels = new Map(
			options.map((option) => [option.value, option.supportedThinkingLevels]),
		);
	}

	function selectModel(value: string) {
		const model = modelOptionModels.get(value);
		if (!model) return;
		onModelChange(model);
		const supportedThinkingLevels = modelOptionThinkingLevels.get(value) ?? [];
		if (
			supportedThinkingLevels.length > 0 &&
			!supportedThinkingLevels.includes(thinkingLevel)
		) {
			onThinkingChange(
				(supportedThinkingLevels.includes("medium")
					? "medium"
					: supportedThinkingLevels[0]) as ThinkingLevel,
			);
		}
	}

	function exactTokenCount(count: number): string {
		return count.toLocaleString("en-US");
	}

	function buildContextBudgetTooltipDetails(budget: ContextBudget) {
		const availableTokens = Math.max(0, budget.maxTokens - budget.usedTokens);
		return [
			{ label: "Context", value: `${exactTokenCount(budget.usedTokens)} tok` },
			{ label: "Window", value: `${exactTokenCount(budget.maxTokens)} tok` },
			{ label: "Available", value: `${exactTokenCount(availableTokens)} tok` },
			{ label: "Used", value: `${budget.percent}%` },
		];
	}
</script>

<div
	role="group"
	aria-label="Message composer"
	class={`composer-shell ${isDragActive ? "drag-active" : ""}`.trim()}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
>
	<div class="composer-frame expanded">
		{#if errorMessage}
			<p class="composer-error">{errorMessage}</p>
		{/if}

		{#if showMentionPicker}
			<div bind:this={mentionRoot} class="mention-picker" role="listbox" aria-label="Workspace paths">
				{#if mentionLoading}
					<div class="mention-empty">Indexing workspace paths...</div>
				{:else if mentionError}
					<div class="mention-empty danger">{mentionError}</div>
				{:else if mentionResults.length === 0}
					<div class="mention-empty">No indexed file or folder matches @{mentionQuery?.query}</div>
				{:else}
					{#each mentionResults as result, index (result.id)}
						<button
							class={`mention-option ${index === activeMentionIndex ? "active" : ""}`.trim()}
							type="button"
							role="option"
							aria-selected={index === activeMentionIndex}
							onmousedown={(event) => event.preventDefault()}
							onclick={() => void chooseMention(result)}
						>
							{#if result.type === "snippet"}
								<FileTextIcon size={14} aria-hidden="true" />
							{:else if result.kind === "folder"}
								<FolderIcon size={14} aria-hidden="true" />
							{:else}
								<FileIcon size={14} aria-hidden="true" />
							{/if}
							<span>{result.basename}</span>
							<small>{result.disambiguation || (result.type === "snippet" ? result.snippet.source : result.workspaceRelativePath)}</small>
						</button>
					{/each}
				{/if}
			</div>
		{/if}

		<div class="composer-main-row">
			<div
				class="composer-input-wrap"
				role="presentation"
				onpointerdown={prepareComposerFrameFocus}
				onpointerup={focusComposerFromFrame}
			>
				{#if editDraft}
					<section class="composer-edit-row" aria-label="Editing message">
						<span>Editing message</span>
						<button type="button" onclick={cancelEditMessage}>Cancel</button>
					</section>
				{/if}
				{#if queuedMessages.length > 0}
					<QueuedMessagesStrip
						{queuedMessages}
						onEdit={(promptId) => void editQueuedMessage(promptId)}
						onDelete={onDeleteQueuedMessage}
						onSteer={onSteerQueuedMessage}
						onReorder={onReorderQueuedMessage}
					/>
				{/if}
				{#if snippetMentions.length > 0 || attachments.length > 0 || showImageModelWarning}
					<section class="composer-context-row" aria-label="Attached file and context items">
						{#if showImageModelWarning}
							<div class="composer-attachment-warning" role="status">
								<TriangleAlertIcon size={13} aria-hidden="true" />
								<span>Current model is not listed as image-capable. Image attachments may be ignored or rejected.</span>
							</div>
						{/if}
						{#if snippetMentions.length > 0}
							<div class="snippet-mention-row" aria-label="Snippet mentions">
								{#each snippetMentions as mention (mention.id)}
									<div class="snippet-mention-chip">
										<div class="snippet-mention-main">
											<FileTextIcon size={13} aria-hidden="true" />
											<span class="snippet-title">{mention.token}</span>
											<span class="snippet-source">{mention.source}</span>
											<button type="button" onclick={() => void expandSnippetMention(mention)}>
												Expand
											</button>
											<button
												type="button"
												aria-label={`Remove snippet ${mention.title}`}
												onclick={() => void removeSnippetMention(mention)}
											>
												<XIcon size={11} aria-hidden="true" />
											</button>
										</div>
										{#if mention.arguments.length > 0}
											<div class="snippet-argument-row">
												{#each mention.arguments as argument, index (`${mention.id}:arg:${index}`)}
													<input
														value={argument}
														data-snippet-argument={`${mention.id}:${index}`}
														aria-label={`${mention.title} argument ${index + 1}`}
														placeholder={mention.metadata.argumentHint ?? `Argument ${index + 1}`}
														oninput={(event) =>
															updateSnippetMentionArgument(
																mention.id,
																index,
																event.currentTarget.value,
															)}
														onkeydown={(event) =>
															void handleSnippetArgumentKeydown(
																event,
																mention.id,
																index,
																mention.arguments.length,
															)}
													/>
												{/each}
											</div>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
						<div class="mention-chip-row">
							{#each attachments as attachment (attachment.id)}
								<Tooltip label={`Remove ${attachmentLabel(attachment)}`}>
									<button
										class="mention-chip"
										type="button"
										aria-label={`Remove attachment ${attachmentLabel(attachment)}`}
										onclick={() => removeAttachment(attachment.id)}
									>
										{#if attachment.kind === "image" && attachment.dataBase64 && attachment.mimeType}
											<img
												class="attachment-thumb"
												src={`data:${attachment.mimeType};base64,${attachment.dataBase64}`}
												alt=""
											/>
										{:else if attachment.kind === "folder"}
											<FolderIcon size={12} aria-hidden="true" />
										{:else if attachment.kind === "image"}
											<ImageIcon size={12} aria-hidden="true" />
										{:else}
											<FileIcon size={12} aria-hidden="true" />
										{/if}
										<span>{attachmentLabel(attachment)}</span>
										<XIcon size={11} aria-hidden="true" />
									</button>
								</Tooltip>
							{/each}
						</div>
					</section>
				{/if}
				<TextArea
					bind:value={draft}
					bind:element={draftElement}
					resize="vertical"
					rows={1}
					placeholder="Ask svvy to inspect the repo, make a change, or delegate work."
					onkeydown={handleKeydown}
					oninput={handleDraftInput}
					onpaste={handlePaste}
					onkeyup={(event) => syncCaretFromTextarea(event.currentTarget)}
					onclick={(event) => syncCaretFromTextarea(event.currentTarget)}
					onselect={(event) => syncCaretFromTextarea(event.currentTarget)}
				/>

				<div class="focused-context-budget">
					<ContextBudgetBar
						budget={contextBudget ?? null}
						variant="full"
						label="Context"
						tooltipLabel={contextBudgetTooltip}
						tooltipDetails={contextBudgetTooltipDetails}
					/>
				</div>
				<div class="composer-row-actions">
					<div class="composer-control-cluster" aria-label="Runtime controls">
						<CompactCombobox
							bind:open={showModelMenu}
							value={modelValue}
							options={visibleModelOptions}
							ariaLabel="Change model"
							placeholder="Search models"
							emptyLabel="No models match."
							disabled={!currentModel}
							triggerClass="model-pill model-control"
							menuClass="model-menu"
							optionClass="model-option"
							onBeforeOpen={loadModelOptions}
							onSelect={selectModel}
						/>
						<CompactSelect
							bind:open={showThinkingMenu}
							value={thinkingLevel}
							options={thinkingOptions}
							ariaLabel="Thinking level"
							triggerClass="ghost-select thinking-field"
							textTransform="lowercase"
							onSelect={(level) => onThinkingChange(level as ThinkingLevel)}
						/>
						{#if extensionUsageItems.length > 0}
							<ExtensionUsageControl
								ariaLabel="Extension usage"
								actor={extensionActor}
								items={extensionUsageItems}
								onOpenExtension={onOpenExtension}
								onStateChange={onExtensionUsageChange}
							/>
						{/if}
					</div>
					<div class="composer-action-cluster" aria-label="Composer actions">
						<Tooltip label="Attach file context">
							<button
								class="composer-icon-button"
								type="button"
								aria-label="Attach file context"
								onclick={() => void attachPickedWorkspaceFiles()}
							>
								<PaperclipIcon size={15} aria-hidden="true" />
							</button>
						</Tooltip>
						{#if isStreaming}
							<Tooltip label={workingElapsedTooltip}>
								<span class="composer-working-timer" role="status" aria-label={workingElapsedTooltip}>
									<ClockIcon size={14} aria-hidden="true" />
									<span>{workingElapsedLabel}</span>
								</span>
							</Tooltip>
						{/if}
						{#if isStreaming}
							<Tooltip label={isStopping ? "Stopping agent" : "Stop agent"} disabled={isStopping}>
								<button
									class="composer-submit composer-stop"
									type="button"
									aria-label="Stop agent"
									onclick={() => void stopStreaming()}
									disabled={isStopping}
								>
									<SquareIcon size={13} aria-hidden="true" />
								</button>
							</Tooltip>
						{:else}
							<Tooltip label="Send message" disabled={!currentModel || !canSubmit || isSubmitting}>
								<button
									class="composer-submit"
									type="button"
									aria-label="Send"
									onclick={() => void submit()}
									disabled={!currentModel || !canSubmit || isSubmitting}
								>
									<ArrowUpIcon size={15} aria-hidden="true" />
								</button>
							</Tooltip>
						{/if}
					</div>
				</div>
			</div>
		</div>

	</div>
</div>

<style>
	.composer-shell {
		container-type: inline-size;
		padding: 0;
		background: transparent;
	}

	.composer-frame {
		display: grid;
		gap: 0;
		transition: background-color 160ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.composer-context-row {
		border-top: 1px solid var(--ui-border-soft);
	}

	.composer-edit-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.34rem 0.52rem 0.32rem;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-accent) 48%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-accent-soft) 52%, transparent);
		color: var(--ui-text-secondary);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.composer-edit-row button {
		border: 0;
		background: transparent;
		color: var(--ui-accent);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.composer-edit-row button:hover,
	.composer-edit-row button:focus-visible {
		color: var(--ui-text-primary);
	}

	.composer-context-row {
		padding: 0.42rem 0.52rem 0.38rem;
		border-top: 0;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 70%, transparent);
	}

	.thinking-wrap {
		position: relative;
	}

	.mention-chip-row {
		display: flex;
		align-items: center;
		gap: 0.38rem;
		flex-wrap: wrap;
		min-width: 0;
	}

	.snippet-mention-row {
		display: grid;
		gap: 0.36rem;
		margin-bottom: 0.38rem;
	}

	.snippet-mention-chip {
		display: grid;
		gap: 0.32rem;
		max-width: 100%;
		padding: 0.36rem 0.42rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-accent) 54%, var(--ui-border-soft));
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-accent-soft) 34%, var(--ui-surface));
	}

	.snippet-mention-main {
		display: flex;
		align-items: center;
		gap: 0.34rem;
		min-width: 0;
		color: color-mix(in oklab, var(--ui-accent) 72%, var(--ui-text-primary));
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.snippet-title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 700;
	}

	.snippet-source {
		flex: 0 0 auto;
		padding: 0.04rem 0.26rem;
		border-radius: var(--ui-radius-xs);
		background: color-mix(in oklab, var(--ui-surface-raised) 78%, transparent);
		color: var(--ui-text-secondary);
		font-size: 0.64rem;
		text-transform: uppercase;
	}

	.snippet-mention-main button {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 1.22rem;
		border: 1px solid transparent;
		border-radius: var(--ui-radius-xs);
		background: transparent;
		color: var(--ui-text-secondary);
		font: inherit;
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.snippet-mention-main button:hover,
	.snippet-mention-main button:focus-visible {
		outline: none;
		border-color: var(--ui-border-soft);
		color: var(--ui-text-primary);
		background: color-mix(in oklab, var(--ui-surface-raised) 78%, transparent);
	}

	.snippet-argument-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		gap: 0.3rem;
	}

	.snippet-argument-row input {
		min-width: 0;
		width: 100%;
		padding: 0.26rem 0.34rem;
		border: 1px solid var(--ui-border-soft);
		border-radius: var(--ui-radius-xs);
		background: color-mix(in oklab, var(--ui-surface) 78%, transparent);
		color: var(--ui-text-primary);
		font: inherit;
		font-size: var(--text-xs);
	}

	.snippet-argument-row input:focus {
		outline: none;
		border-color: color-mix(in oklab, var(--ui-accent) 62%, var(--ui-border-strong));
	}

	.mention-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		max-width: min(100%, 18rem);
		min-height: 1.32rem;
		padding: 0.12rem 0.36rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-accent) 58%, var(--ui-border-soft));
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-accent-soft) 54%, var(--ui-surface));
		color: color-mix(in oklab, var(--ui-accent) 78%, var(--ui-text-primary));
		font: inherit;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.mention-chip span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}

	.attachment-thumb {
		width: 1.15rem;
		height: 1.15rem;
		border-radius: var(--ui-radius-xs);
		object-fit: cover;
		background: var(--ui-code);
	}

	.mention-chip:hover,
	.mention-chip:focus-visible {
		outline: none;
		border-color: color-mix(in oklab, var(--ui-accent) 62%, var(--ui-border-strong));
		background: color-mix(in oklab, var(--ui-accent-soft) 54%, var(--ui-surface-raised));
		color: var(--ui-text-primary);
	}

	.composer-main-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
		width: min(100%, 45.5rem);
		margin: 0 auto;
		min-height: 0;
		padding: 0.58rem 0.72rem 0.48rem;
	}

	.composer-input-wrap {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 8.55rem;
		overflow: visible;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
		border-radius: var(--ui-radius-md);
		background: color-mix(in oklab, var(--ui-surface-subtle) 38%, transparent);
		cursor: text;
		transition:
			border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
			box-shadow 150ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.composer-input-wrap:hover {
		border-color: color-mix(in oklab, var(--ui-border-strong) 70%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-surface-subtle) 54%, transparent);
	}

	.composer-input-wrap:focus-within {
		border-color: color-mix(in oklab, var(--ui-border-strong) 82%, var(--ui-accent));
		background: color-mix(in oklab, var(--ui-surface) 86%, var(--ui-surface-subtle));
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ui-accent) 14%, transparent);
	}

	.drag-active .composer-input-wrap {
		border-color: color-mix(in oklab, var(--ui-accent) 72%, var(--ui-border-strong));
		background: color-mix(in oklab, var(--ui-accent-soft) 28%, var(--ui-surface));
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ui-accent) 22%, transparent);
	}

	.composer-attachment-warning {
		display: flex;
		align-items: center;
		gap: 0.32rem;
		margin-bottom: 0.34rem;
		color: var(--ui-warning);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	:global(.composer-shell .ui-textarea) {
		flex: 1 1 auto;
		min-height: 2.35rem;
		max-height: 10.5rem;
		padding: 0.46rem 0.52rem 0.38rem;
		border: 0;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
		color: var(--ui-text-primary);
		font-size: var(--text-base);
		line-height: 1.45;
		resize: none;
	}

	:global(.composer-shell .ui-textarea:hover),
	:global(.composer-shell .ui-textarea:focus-visible) {
		border-color: transparent;
		background: transparent;
		box-shadow: none;
	}

	.composer-row-actions,
	.composer-control-cluster,
	.composer-action-cluster {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.composer-row-actions {
		margin-top: auto;
		padding: 0.28rem 0.32rem 0.32rem 0.44rem;
		border-radius: 0 0 var(--ui-radius-md) var(--ui-radius-md);
		background: transparent;
		justify-content: space-between;
		align-content: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		width: 100%;
		cursor: default;
	}

	.composer-control-cluster,
	.composer-action-cluster {
		flex: 0 0 auto;
		gap: 0.46rem;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: transparent;
	}

	.composer-control-cluster {
		max-width: 21rem;
	}

	.composer-action-cluster {
		margin-left: auto;
	}

	.composer-icon-button,
	.composer-submit {
		position: relative;
		display: inline-grid;
		place-items: center;
		flex: 0 0 auto;
		width: 1.9rem;
		height: 1.9rem;
		border: 1px solid transparent;
		border-radius: var(--ui-radius-md);
		background: transparent;
		color: var(--ui-text-tertiary);
		cursor: pointer;
		transition:
			border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
			color 150ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.composer-icon-button:hover,
	.composer-icon-button:focus-visible {
		outline: none;
		border-color: var(--ui-border-soft);
		background: var(--ui-surface-subtle);
		color: var(--ui-text-primary);
	}

	.composer-submit {
		border-color: color-mix(in oklab, var(--ui-accent) 68%, var(--ui-border-accent));
		background: var(--ui-accent);
		color: var(--ui-accent-ink);
	}

	.composer-submit:hover,
	.composer-submit:focus-visible {
		outline: none;
		background: var(--ui-accent-strong);
	}

	.composer-stop {
		border-color: color-mix(in oklab, var(--ui-danger) 44%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-danger-soft) 88%, var(--ui-surface));
		color: color-mix(in oklab, var(--ui-danger) 86%, var(--ui-text-primary));
	}

	.composer-stop:hover,
	.composer-stop:focus-visible {
		background: var(--ui-danger-soft);
		color: var(--ui-danger);
	}

	.composer-submit:disabled {
		border-color: var(--ui-border-soft);
		background: var(--ui-surface-muted);
		color: var(--ui-text-tertiary);
		cursor: default;
	}

	.composer-working-timer {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		flex: 0 0 auto;
		min-width: 3.55rem;
		height: 1.9rem;
		padding: 0 0.44rem;
		border: 1px solid color-mix(in oklab, var(--ui-accent) 28%, var(--ui-border-soft));
		border-radius: var(--ui-radius-md);
		background: color-mix(in oklab, var(--ui-accent) 9%, transparent);
		color: var(--ui-accent);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}

	.composer-icon-button:focus-visible,
	.composer-submit:focus-visible,
	.mention-chip:focus-visible {
		box-shadow: var(--ui-focus-ring);
	}

	.focused-context-budget {
		min-height: 1.7rem;
		margin-top: 0.42rem;
	}

	.mention-picker {
		display: grid;
		gap: 0.12rem;
		width: min(100%, 45.5rem);
		max-height: 15rem;
		overflow: auto;
		margin: 0 auto 0.35rem;
		padding: 0.24rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		border-radius: var(--ui-radius-md);
		background: var(--ui-surface-raised);
		box-shadow: var(--ui-shadow-strong);
	}

	.mention-option {
		display: grid;
		grid-template-columns: 1rem minmax(4rem, max-content) minmax(0, 1fr);
		align-items: center;
		gap: 0.5rem;
		min-height: 1.9rem;
		padding: 0.32rem 0.44rem;
		border: 1px solid transparent;
		border-radius: var(--ui-radius-sm);
		background: transparent;
		color: var(--ui-text-primary);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.mention-option span,
	.mention-option small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mention-option span {
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.mention-option small {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ui-text-secondary);
	}

	.mention-option:hover,
	.mention-option:focus-visible,
	.mention-option.active {
		outline: none;
		border-color: color-mix(in oklab, var(--ui-border-accent) 70%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-accent-soft) 62%, var(--ui-surface-raised));
	}

	.mention-empty {
		padding: 0.55rem 0.6rem;
		font-size: var(--text-sm);
		color: var(--ui-text-secondary);
	}

	.mention-empty.danger {
		color: var(--ui-danger);
	}

	.composer-error {
		margin: 0;
		padding: 0.55rem 0.72rem;
		border: 1px solid color-mix(in oklab, var(--ui-danger) 22%, var(--ui-border-soft));
		border-width: 0 0 1px;
		border-radius: 0;
		background: color-mix(in oklab, var(--ui-danger-soft) 74%, transparent);
		color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
		font-size: var(--text-base);
		line-height: 1.5;
	}

	@media (max-width: 760px) {
		.composer-main-row {
			grid-template-columns: minmax(0, 1fr);
			padding: 0.5rem;
		}

		.composer-icon-button,
		.composer-submit,
		.mention-option {
			min-height: 2.75rem;
		}

		.composer-icon-button,
		.composer-submit {
			width: 2.75rem;
			height: 2.75rem;
		}

		.composer-working-timer {
			height: 2.75rem;
			min-width: 4.45rem;
		}

		.compact-budget {
			display: none;
		}

		.composer-control-cluster {
			display: none;
		}

		.composer-row-actions {
			align-items: flex-start;
			flex-direction: column;
			justify-content: flex-start;
		}
	}

	@container (max-width: 420px) {
		.composer-main-row {
			grid-template-columns: 1fr;
			padding: 0.48rem 0.56rem 0.42rem;
		}

		.composer-input-wrap {
			min-height: 8.95rem;
		}

		:global(.composer-shell .ui-textarea) {
			min-height: 4.2rem;
			font-size: var(--text-base);
		}

		.composer-row-actions {
			justify-content: flex-start;
			gap: 0.3rem;
		}

		.compact-budget {
			display: none;
		}

		.composer-control-cluster {
			display: none;
		}

	}
</style>
