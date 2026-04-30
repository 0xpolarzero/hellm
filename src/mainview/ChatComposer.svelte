<script lang="ts">
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import FileIcon from "@lucide/svelte/icons/file";
	import FolderIcon from "@lucide/svelte/icons/folder";
	import GitBranchIcon from "@lucide/svelte/icons/git-branch";
	import AtSignIcon from "@lucide/svelte/icons/at-sign";
	import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
	import SquareIcon from "@lucide/svelte/icons/square";
	import XIcon from "@lucide/svelte/icons/x";
	import { onMount, tick } from "svelte";
	import { supportsXhigh, type Model } from "@mariozechner/pi-ai";
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
		getActiveMentionQuery,
		removeMentionFromDraft,
		searchMentionPaths,
		selectMentionPath,
		serializeComposerDraft,
		type ComposerMentionLink,
		type MentionPickerResult,
		type WorkspacePathIndexEntry,
	} from "./composer-mentions";
	import ContextBudgetBar from "./ContextBudgetBar.svelte";
	import TextArea from "./ui/TextArea.svelte";

	type Props = {
		currentModel: Model<any> | null;
		thinkingLevel: ThinkingLevel;
		isStreaming: boolean;
		promptHistory: PromptHistoryEntry[];
		errorMessage?: string;
		usageText?: string;
		contextBudget?: ContextBudget | null;
		sessionName?: string;
		targetLabel?: string;
		worktreeLabel?: string;
		onAbort: () => void;
		onOpenModelPicker: () => void;
		onSend: (input: string) => Promise<boolean> | boolean;
		onThinkingChange: (level: ThinkingLevel) => void;
		listWorkspacePaths: () => Promise<WorkspacePathIndexEntry[]>;
	};

	const BASE_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

	let {
		currentModel,
		thinkingLevel,
		isStreaming,
		promptHistory,
		errorMessage,
		usageText,
		contextBudget,
		sessionName = "Current session",
		targetLabel = "orchestrator",
		worktreeLabel = "worktree",
		onAbort,
		onOpenModelPicker,
		onSend,
		onThinkingChange,
		listWorkspacePaths,
	}: Props = $props();

	let draft = $state("");
	let isSubmitting = $state(false);
	let showThinkingMenu = $state(false);
	let draftElement = $state<HTMLTextAreaElement | null>(null);
	let thinkingMenuRoot = $state<HTMLDivElement | null>(null);
	let historyNavigation = $state<PromptHistoryNavigationState>(createPromptHistoryNavigationState());
	let mentionRoot = $state<HTMLDivElement | null>(null);
	let workspacePaths = $state<WorkspacePathIndexEntry[]>([]);
	let workspacePathsLoaded = $state(false);
	let mentionLoading = $state(false);
	let mentionError = $state<string | null>(null);
	let selectedMentions = $state<ComposerMentionLink[]>([]);
	let activeMentionIndex = $state(0);
	let caretPosition = $state(0);
	let dismissedMentionQueryKey = $state<string | null>(null);
	const availableThinkingLevels = $derived(
		currentModel && supportsXhigh(currentModel) ? [...BASE_LEVELS, "xhigh"] : BASE_LEVELS,
	);
	const mentionQuery = $derived(getActiveMentionQuery(draft, caretPosition));
	const mentionQueryKey = $derived(mentionQuery ? `${mentionQuery.start}:${mentionQuery.query}` : null);
	const activeMentionIsSelected = $derived(
		Boolean(
			mentionQuery &&
				selectedMentions.some(
					(mention) =>
						mention.workspaceRelativePath === mentionQuery.query &&
						draft.slice(mentionQuery.start, mentionQuery.end) === `@${mention.workspaceRelativePath}`,
				),
		),
	);
	const mentionResults = $derived<MentionPickerResult[]>(
		mentionQuery && workspacePathsLoaded ? searchMentionPaths(workspacePaths, mentionQuery.query, 10) : [],
	);
	const showMentionPicker = $derived(
		Boolean(
			mentionQuery &&
				!activeMentionIsSelected &&
				mentionQueryKey !== dismissedMentionQueryKey &&
				(mentionLoading || mentionError || workspacePathsLoaded || mentionResults.length > 0),
		),
	);

	onMount(() => {
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (thinkingMenuRoot?.contains(target)) return;
			if (mentionRoot?.contains(target) || draftElement?.contains(target)) return;
			showThinkingMenu = false;
			closeMentionPicker();
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				showThinkingMenu = false;
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

	function resetHistoryNavigation() {
		historyNavigation = createPromptHistoryNavigationState();
	}

	function moveCaretToDraftEnd(value: string) {
		draftElement?.focus();
		draftElement?.setSelectionRange(value.length, value.length);
		caretPosition = value.length;
	}

	function syncCaretFromTextarea(target: EventTarget | null) {
		if (!(target instanceof HTMLTextAreaElement)) return;
		caretPosition = target.selectionStart;
		if (getActiveMentionQuery(target.value, target.selectionStart, target.selectionEnd)) {
			void ensureWorkspacePaths();
		}
	}

	async function ensureWorkspacePaths() {
		if (workspacePathsLoaded || mentionLoading) return;
		mentionLoading = true;
		mentionError = null;
		try {
			workspacePaths = await listWorkspacePaths();
			workspacePathsLoaded = true;
		} catch (error) {
			mentionError = error instanceof Error ? error.message : "Workspace paths unavailable.";
		} finally {
			mentionLoading = false;
		}
	}

	function closeMentionPicker() {
		activeMentionIndex = 0;
		dismissedMentionQueryKey = mentionQueryKey;
	}

	async function chooseMention(result: MentionPickerResult) {
		if (!mentionQuery) return;
		const selection = selectMentionPath(draft, mentionQuery, result);
		draft = selection.draft;
		selectedMentions = [
			...selectedMentions.filter(
				(mention) => mention.workspaceRelativePath !== selection.mention.workspaceRelativePath,
			),
			selection.mention,
		];
		activeMentionIndex = 0;
		dismissedMentionQueryKey = `${mentionQuery.start}:${selection.mention.workspaceRelativePath}`;
		await tick();
		draftElement?.focus();
		draftElement?.setSelectionRange(selection.caret, selection.caret);
		caretPosition = selection.caret;
	}

	async function removeMention(mention: ComposerMentionLink) {
		draft = removeMentionFromDraft(draft, mention);
		selectedMentions = selectedMentions.filter((item) => item.id !== mention.id);
		await tick();
		moveCaretToDraftEnd(draft);
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
		if (!draft.trim() || isStreaming || isSubmitting) return;
		const nextDraft = serializeComposerDraft(draft);
		draft = "";
		selectedMentions = [];
		isSubmitting = true;

		try {
			const sent = await onSend(nextDraft);
			if (sent) {
				resetHistoryNavigation();
			} else {
				await restoreDraftBuffer(nextDraft);
			}
		} catch {
			await restoreDraftBuffer(nextDraft);
		} finally {
			isSubmitting = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		const target = event.currentTarget;
		if (showMentionPicker && mentionQuery) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const direction = event.key === "ArrowDown" ? 1 : -1;
				activeMentionIndex =
					(mentionResults.length + activeMentionIndex + direction) % Math.max(mentionResults.length, 1);
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

	function selectThinkingLevel(level: ThinkingLevel) {
		onThinkingChange(level);
		showThinkingMenu = false;
	}

	function focusMentionEntry() {
		void tick().then(() => {
			draftElement?.focus();
			if (!draft.includes("@")) {
				draft = draft ? `${draft} @` : "@";
				moveCaretToDraftEnd(draft);
				void ensureWorkspacePaths();
			}
		});
	}
</script>

<div class="composer-shell">
	<div class="composer-frame expanded">
		{#if errorMessage}
			<p class="composer-error">{errorMessage}</p>
		{/if}

		<section class="composer-context-row" aria-label="Selected workspace mentions">
			<div class="mention-chip-row">
				{#each selectedMentions as mention (mention.id)}
					<button
						class="mention-chip"
						type="button"
						aria-label={`Remove ${mention.workspaceRelativePath}`}
						onclick={() => void removeMention(mention)}
					>
						{#if mention.kind === "folder"}
							<FolderIcon size={12} aria-hidden="true" />
						{:else}
							<FileIcon size={12} aria-hidden="true" />
						{/if}
						<span>{mention.workspaceRelativePath}</span>
						<XIcon size={11} aria-hidden="true" />
					</button>
				{/each}
				<button class="mention-add-chip" type="button" onclick={focusMentionEntry}>
					<AtSignIcon size={12} aria-hidden="true" />
					<span>Add context</span>
				</button>
			</div>
		</section>

		<div class="composer-main-row">
			<div class="composer-input-wrap">
				<TextArea
					bind:value={draft}
					bind:element={draftElement}
					resize="vertical"
					rows={4}
					placeholder="Ask svvy to inspect the repo, make a change, or run Project CI."
					onkeydown={handleKeydown}
					oninput={(event) => syncCaretFromTextarea(event.currentTarget)}
					onkeyup={(event) => syncCaretFromTextarea(event.currentTarget)}
					onclick={(event) => syncCaretFromTextarea(event.currentTarget)}
					onselect={(event) => syncCaretFromTextarea(event.currentTarget)}
				/>
			</div>

			<div class="composer-row-actions">
				<button class="model-pill model-control" type="button" disabled={!currentModel} onclick={() => onOpenModelPicker()}>
					<strong>{currentModel?.name ?? "No surface"}</strong>
				</button>
				<div bind:this={thinkingMenuRoot} class="thinking-wrap compact-thinking-wrap">
					<button
						class="model-pill thinking-field"
						type="button"
						aria-haspopup="listbox"
						aria-expanded={showThinkingMenu}
						aria-label="Thinking level"
						onclick={() => (showThinkingMenu = !showThinkingMenu)}
					>
						<strong>{thinkingLevel}</strong>
						<ChevronDownIcon
							class={`thinking-chevron ${showThinkingMenu ? "open" : ""}`.trim()}
							aria-hidden="true"
							size={13}
							strokeWidth={1.9}
						/>
					</button>
					{#if showThinkingMenu}
						<div class="thinking-menu" role="listbox" aria-label="Thinking level options">
							{#each availableThinkingLevels as level}
								<button
									class={`thinking-option ${level === thinkingLevel ? "active" : ""}`.trim()}
									type="button"
									role="option"
									aria-selected={level === thinkingLevel}
									onclick={() => selectThinkingLevel(level)}
								>
									<span>{level}</span>
									{#if level === thinkingLevel}
										<span class="thinking-option-state">Current</span>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
				<div class="compact-budget">
					<ContextBudgetBar budget={contextBudget ?? null} variant="compact" label="Context" />
				</div>
				<button class="composer-icon-button" type="button" title="Add @mention" aria-label="Add @mention" onclick={focusMentionEntry}>
					<AtSignIcon size={15} aria-hidden="true" />
				</button>
				{#if isStreaming}
					<button class="composer-submit danger" type="button" aria-label="Stop" title="Stop" onclick={onAbort}>
						<SquareIcon size={13} aria-hidden="true" />
					</button>
				{:else}
					<button
						class="composer-submit"
						type="button"
						aria-label="Send"
						title="Send"
						onclick={() => void submit()}
						disabled={!currentModel || !draft.trim() || isSubmitting}
					>
						<ArrowUpIcon size={15} aria-hidden="true" />
					</button>
				{/if}
			</div>
		</div>

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
							{#if result.kind === "folder"}
								<FolderIcon size={14} aria-hidden="true" />
							{:else}
								<FileIcon size={14} aria-hidden="true" />
							{/if}
							<span>{result.basename}</span>
							<small>{result.disambiguation || result.workspaceRelativePath}</small>
						</button>
					{/each}
				{/if}
			</div>
		{/if}

		<div class="composer-status-row">
			<div class="composer-targets" aria-label="Composer target context">
				<span class="status-chip">{targetLabel}</span>
				<span class="status-separator">/</span>
				<span class="status-chip session-chip">{sessionName}</span>
				<span class="status-chip worktree-chip"><GitBranchIcon size={10} aria-hidden="true" /> {worktreeLabel}</span>
			</div>

			{#if usageText}
				<p class="composer-usage">usage {usageText}</p>
			{/if}
		</div>

		{#if selectedMentions.length > 0}
			<div class="mention-resolution-row" aria-label="Mention serialization preview">
				{#each selectedMentions as mention (mention.id)}
					<span>@{mention.workspaceRelativePath}</span>
				{/each}
			</div>
		{/if}

		{#if isStreaming}
			<div class="composer-streaming-row">
				<span class="streaming-dot pulse-dot"></span>
				<span>{targetLabel} is working...</span>
				{#if contextBudget}
					<strong>{contextBudget.label} context used</strong>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.composer-shell {
		container-type: inline-size;
		padding: 0;
		border-top: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		background: var(--ui-surface);
	}

	.composer-frame {
		display: grid;
		gap: 0;
		transition: background-color 160ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.composer-frame:focus-within {
		box-shadow: inset 0 1px 0 color-mix(in oklab, var(--ui-accent) 46%, transparent);
	}

	.composer-context-row,
	.composer-status-row,
	.mention-resolution-row,
	.composer-streaming-row {
		border-top: 1px solid var(--ui-border-soft);
	}

	.composer-context-row {
		padding: 0.5rem 0.72rem;
		border-top: 0;
		border-bottom: 1px solid var(--ui-border-soft);
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
		font-size: 0.62rem;
		cursor: pointer;
	}

	.mention-add-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.26rem;
		min-height: 1.32rem;
		padding: 0.12rem 0.4rem;
		border: 1px dashed var(--ui-border-soft);
		border-radius: var(--ui-radius-sm);
		background: transparent;
		color: var(--ui-text-tertiary);
		font: inherit;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		cursor: pointer;
		transition:
			border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
			color 150ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.mention-chip span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}

	.mention-chip:hover,
	.mention-chip:focus-visible,
	.mention-add-chip:hover,
	.mention-add-chip:focus-visible {
		outline: none;
		border-color: color-mix(in oklab, var(--ui-accent) 62%, var(--ui-border-strong));
		background: color-mix(in oklab, var(--ui-accent-soft) 54%, var(--ui-surface-raised));
		color: var(--ui-text-primary);
	}

	.composer-main-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		gap: 0.72rem;
		min-height: 6.65rem;
		padding: 0.58rem 0.72rem 0.48rem;
	}

	.composer-input-wrap {
		min-width: 0;
	}

	:global(.composer-shell .ui-textarea) {
		min-height: 4.65rem;
		max-height: 15rem;
		padding: 0.12rem 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
		color: var(--ui-text-primary);
		font-size: 0.81rem;
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
	.composer-runtime,
	.composer-targets {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.composer-row-actions {
		justify-content: flex-end;
		gap: 0.36rem;
		flex-wrap: wrap;
		max-width: 18rem;
	}

	.composer-icon-button,
	.composer-submit {
		display: inline-grid;
		place-items: center;
		flex: 0 0 auto;
		width: 1.75rem;
		height: 1.75rem;
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

	.composer-submit:disabled {
		border-color: var(--ui-border-soft);
		background: var(--ui-surface-muted);
		color: var(--ui-text-tertiary);
		cursor: not-allowed;
	}

	.composer-submit.danger {
		border-color: color-mix(in oklab, var(--ui-danger) 42%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-danger-soft) 82%, var(--ui-surface));
		color: var(--ui-danger);
	}

	.model-pill,
	.status-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.28rem;
		min-width: 0;
		max-width: 10rem;
		min-height: 1.35rem;
		padding: 0.1rem 0.42rem;
		border: 1px solid var(--ui-border-soft);
		border-radius: var(--ui-radius-sm);
		background: transparent;
		color: var(--ui-text-tertiary);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		line-height: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.model-pill {
		cursor: pointer;
	}

	.model-pill strong {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.62rem;
		font-weight: 650;
	}

	.model-pill.thinking-field {
		max-width: 7rem;
		padding-right: 1.35rem;
	}

	.model-pill:hover,
	.model-pill:focus-visible {
		outline: none;
		border-color: color-mix(in oklab, var(--ui-accent) 52%, var(--ui-border-soft));
		color: var(--ui-text-primary);
	}

	.compact-budget {
		position: relative;
		width: 5.8rem;
		height: 1.25rem;
	}

	.compact-budget :global(.context-budget-compact) {
		inset: auto 0 0.28rem 0;
	}

	.mention-picker {
		display: grid;
		gap: 0.12rem;
		width: min(calc(100% - 1.44rem), 34rem);
		max-height: 15rem;
		overflow: auto;
		margin: 0 0.72rem 0.55rem;
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
		font-size: 0.73rem;
		font-weight: 650;
	}

	.mention-option small {
		font-family: var(--font-mono);
		font-size: 0.63rem;
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
		font-size: 0.72rem;
		color: var(--ui-text-secondary);
	}

	.mention-empty.danger {
		color: var(--ui-danger);
	}

	.composer-status-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
		min-width: 0;
		padding: 0.28rem 0.72rem 0.34rem;
	}

	.composer-targets,
	.composer-runtime {
		gap: 0.42rem;
	}

	.status-separator {
		color: var(--ui-border-strong);
		font-size: 0.66rem;
	}

	.session-chip {
		max-width: 12rem;
	}

	.worktree-chip {
		max-width: 13rem;
	}

	.composer-runtime {
		justify-content: flex-end;
		flex: 1 1 auto;
	}

	.composer-runtime :global(.context-budget-full) {
		width: min(15rem, 28vw);
		min-width: 8rem;
	}

	.composer-control {
		display: inline-flex;
		align-items: center;
		gap: 0.34rem;
		min-height: 1.35rem;
		max-width: 12rem;
		padding: 0.1rem 0.42rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 74%, transparent);
		border-radius: var(--ui-radius-sm);
		background: transparent;
		color: var(--ui-text-tertiary);
		font: inherit;
		font-family: var(--font-mono);
		text-align: left;
		cursor: pointer;
	}

	.thinking-field {
		position: relative;
		padding-right: 1.55rem;
	}

	.composer-control-label {
		font-size: 0.62rem;
		font-family: var(--font-mono);
		color: var(--ui-text-secondary);
	}

	:global(.thinking-chevron) {
		position: absolute;
		right: 0.56rem;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
		transition: transform 150ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	:global(.thinking-chevron.open) {
		transform: translateY(-50%) rotate(180deg);
	}

	.composer-control:hover,
	.composer-control:focus-visible {
		outline: none;
		border-color: color-mix(in oklab, var(--ui-accent) 58%, var(--ui-border-strong));
		background: color-mix(in oklab, var(--ui-surface-subtle) 54%, transparent);
	}

	.thinking-menu {
		position: absolute;
		right: 0;
		bottom: calc(100% + 0.35rem);
		z-index: var(--ui-z-overlay);
		display: grid;
		min-width: max(11rem, 100%);
		max-width: min(14rem, calc(100vw - 2rem));
		padding: 0.28rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		border-radius: var(--ui-radius-md);
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-surface-raised) 86%, transparent), transparent),
			var(--ui-surface-raised);
		box-shadow: var(--ui-shadow-strong);
		transform-origin: bottom right;
	}

	.thinking-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.55rem 0.6rem;
		border: 1px solid transparent;
		border-radius: var(--ui-radius-sm);
		background: transparent;
		color: var(--ui-text-primary);
		font: inherit;
		font-size: 0.74rem;
		font-weight: 600;
		text-transform: lowercase;
		text-align: left;
		cursor: pointer;
	}

	.thinking-option:hover,
	.thinking-option:focus-visible,
	.thinking-option.active {
		outline: none;
		border-color: color-mix(in oklab, var(--ui-border-accent) 72%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-accent-soft) 68%, var(--ui-surface-raised));
	}

	.thinking-option-state {
		font-size: 0.64rem;
		font-family: var(--font-mono);
		color: var(--ui-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.composer-error {
		margin: 0;
		padding: 0.55rem 0.72rem;
		border: 1px solid color-mix(in oklab, var(--ui-danger) 22%, var(--ui-border-soft));
		border-width: 0 0 1px;
		border-radius: 0;
		background: color-mix(in oklab, var(--ui-danger-soft) 74%, transparent);
		color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
		font-size: 0.78rem;
		line-height: 1.5;
	}

	.composer-usage {
		margin: 0;
		font-size: 0.66rem;
		font-family: var(--font-mono);
		color: var(--ui-text-tertiary);
		font-variant-numeric: tabular-nums;
	}

	.mention-resolution-row,
	.composer-streaming-row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
		padding: 0.36rem 0.72rem;
		color: var(--ui-text-tertiary);
		font-family: var(--font-mono);
		font-size: 0.6rem;
	}

	.mention-resolution-row {
		flex-wrap: wrap;
	}

	.mention-resolution-row span {
		max-width: min(100%, 24rem);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.composer-streaming-row {
		color: var(--ui-text-secondary);
	}

	.streaming-dot {
		width: 0.42rem;
		height: 0.42rem;
		border-radius: 999px;
		background: var(--ui-accent);
	}

	.composer-streaming-row strong {
		color: var(--ui-text-tertiary);
		font-weight: 500;
	}

	@media (max-width: 760px) {
		.composer-main-row {
			grid-template-columns: minmax(0, 1fr) auto;
			padding: 0.5rem;
		}

		.composer-icon-button,
		.composer-submit,
		.model-pill,
		.status-chip,
		.composer-control,
		.mention-option {
			min-height: 2.75rem;
		}

		.composer-icon-button,
		.composer-submit {
			width: 2.75rem;
			height: 2.75rem;
		}

		.model-pill,
		.compact-budget {
			display: none;
		}

		.composer-status-row,
		.composer-runtime {
			align-items: flex-start;
			flex-direction: column;
			justify-content: flex-start;
		}

		.composer-status-row {
			padding: 0.44rem 0.5rem;
		}

		.composer-targets {
			width: 100%;
			flex-wrap: wrap;
		}

		.composer-runtime {
			width: 100%;
		}

		.composer-runtime :global(.context-budget-full) {
			width: 100%;
			min-width: 0;
		}
	}

	@container (max-width: 420px) {
		.composer-main-row {
			grid-template-columns: 1fr;
			min-height: 6.1rem;
			padding: 0.48rem 0.56rem 0.42rem;
		}

		:global(.composer-shell .ui-textarea) {
			min-height: 4.2rem;
			font-size: 0.78rem;
		}

		.composer-row-actions {
			justify-content: flex-start;
			gap: 0.3rem;
		}

		.model-pill,
		.compact-budget {
			display: none;
		}

		.composer-status-row {
			padding: 0.24rem 0.56rem 0.3rem;
		}

		.composer-targets {
			flex-wrap: wrap;
			gap: 0.28rem;
		}
	}
</style>
