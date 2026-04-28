<script lang="ts">
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import FileIcon from "@lucide/svelte/icons/file";
	import FolderIcon from "@lucide/svelte/icons/folder";
	import XIcon from "@lucide/svelte/icons/x";
	import { onMount, tick } from "svelte";
	import { supportsXhigh, type Model } from "@mariozechner/pi-ai";
	import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
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
	import Button from "./ui/Button.svelte";
	import TextArea from "./ui/TextArea.svelte";

	type Props = {
		currentModel: Model<any> | null;
		thinkingLevel: ThinkingLevel;
		isStreaming: boolean;
		promptHistory: PromptHistoryEntry[];
		errorMessage?: string;
		usageText?: string;
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
				(mentionLoading || mentionError || mentionResults.length > 0),
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
</script>

<div class="composer-shell">
	<div class="composer-frame">
		{#if errorMessage}
			<p class="composer-error">{errorMessage}</p>
		{/if}

		<TextArea
			bind:value={draft}
			bind:element={draftElement}
			resize="vertical"
			rows={2}
			placeholder="Ask svvy to inspect the repo, make a change, or run Project CI."
			onkeydown={handleKeydown}
			oninput={(event) => syncCaretFromTextarea(event.currentTarget)}
			onkeyup={(event) => syncCaretFromTextarea(event.currentTarget)}
			onclick={(event) => syncCaretFromTextarea(event.currentTarget)}
			onselect={(event) => syncCaretFromTextarea(event.currentTarget)}
		/>

		{#if selectedMentions.length > 0}
			<div class="mention-chip-row" aria-label="Selected workspace mentions">
				{#each selectedMentions as mention (mention.id)}
					<button
						class="mention-chip"
						type="button"
						aria-label={`Remove ${mention.workspaceRelativePath}`}
						onclick={() => void removeMention(mention)}
					>
						{#if mention.kind === "folder"}
							<FolderIcon size={13} aria-hidden="true" />
						{:else}
							<FileIcon size={13} aria-hidden="true" />
						{/if}
						<span>{mention.label}</span>
						<small>{mention.workspaceRelativePath}</small>
						<XIcon size={12} aria-hidden="true" />
					</button>
				{/each}
			</div>
		{/if}

		{#if showMentionPicker}
			<div bind:this={mentionRoot} class="mention-picker" role="listbox" aria-label="Workspace paths">
				{#if mentionLoading}
					<div class="mention-empty">Indexing workspace paths...</div>
				{:else if mentionError}
					<div class="mention-empty">{mentionError}</div>
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
								<FolderIcon size={15} aria-hidden="true" />
							{:else}
								<FileIcon size={15} aria-hidden="true" />
							{/if}
							<span>{result.basename}</span>
							<small>{result.disambiguation || result.workspaceRelativePath}</small>
						</button>
					{/each}
				{/if}
			</div>
		{/if}

		<div class="composer-foot">
			<div class="composer-controls">
				<button
					class="composer-control model-control"
					type="button"
					disabled={!currentModel}
					onclick={() => onOpenModelPicker()}
				>
					<span class="composer-control-label">Model</span>
					<strong>{currentModel?.name ?? "No surface"}</strong>
				</button>
				<div bind:this={thinkingMenuRoot} class="thinking-wrap">
					<button
						class="composer-control thinking-field"
						type="button"
						aria-haspopup="listbox"
						aria-expanded={showThinkingMenu}
						aria-label="Thinking level"
						onclick={() => (showThinkingMenu = !showThinkingMenu)}
					>
						<span class="composer-control-label">Reasoning</span>
						<strong>{thinkingLevel}</strong>
						<ChevronDownIcon
							class={`thinking-chevron ${showThinkingMenu ? "open" : ""}`.trim()}
							aria-hidden="true"
							size={14}
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
			</div>
			<div class="composer-meta">
				{#if usageText}
					<p class="composer-usage">usage {usageText}</p>
				{/if}
				<div class="composer-actions">
					{#if isStreaming}
						<Button variant="danger" size="sm" onclick={onAbort}>Stop</Button>
					{:else}
						<Button variant="primary" size="sm" onclick={() => void submit()} disabled={!currentModel || !draft.trim() || isSubmitting}>
							Send
						</Button>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.composer-shell {
		container-type: inline-size;
		padding: 0.55rem 0.95rem;
		border-top: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-surface-subtle) 78%, transparent), transparent),
			color-mix(in oklab, var(--ui-surface) 72%, transparent);
	}

	.composer-frame {
		display: grid;
		gap: 0.7rem;
	}

	.thinking-wrap {
		position: relative;
	}

	.mention-chip-row {
		display: flex;
		align-items: center;
		gap: 0.42rem;
		flex-wrap: wrap;
		min-width: 0;
	}

	.mention-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.34rem;
		max-width: min(100%, 24rem);
		min-height: 1.8rem;
		padding: 0.24rem 0.46rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-accent) 58%, var(--ui-border-soft));
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-accent-soft) 54%, var(--ui-surface));
		color: var(--ui-text-primary);
		font: inherit;
		font-size: 0.73rem;
		cursor: pointer;
	}

	.mention-chip span,
	.mention-chip small {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mention-chip span {
		font-weight: 650;
	}

	.mention-chip small {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		color: var(--ui-text-secondary);
	}

	.mention-chip:hover,
	.mention-chip:focus-visible {
		outline: none;
		border-color: color-mix(in oklab, var(--ui-accent) 62%, var(--ui-border-strong));
		background: color-mix(in oklab, var(--ui-accent-soft) 76%, var(--ui-surface-raised));
	}

	.mention-picker {
		display: grid;
		gap: 0.18rem;
		width: min(100%, 34rem);
		max-height: 18rem;
		overflow: auto;
		padding: 0.28rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		border-radius: var(--ui-radius-md);
		background: var(--ui-surface-raised);
		box-shadow: var(--ui-shadow-strong);
	}

	.mention-option {
		display: grid;
		grid-template-columns: 1rem minmax(5rem, max-content) minmax(0, 1fr);
		align-items: center;
		gap: 0.55rem;
		min-height: 2.15rem;
		padding: 0.42rem 0.52rem;
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
		font-size: 0.78rem;
		font-weight: 650;
	}

	.mention-option small {
		font-family: var(--font-mono);
		font-size: 0.68rem;
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
		padding: 0.68rem 0.72rem;
		font-size: 0.76rem;
		color: var(--ui-text-secondary);
	}

	.composer-controls,
	.composer-meta,
	.composer-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.composer-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1rem;
		flex-wrap: wrap;
	}

	.composer-meta {
		justify-content: flex-end;
		margin-left: auto;
		min-width: 0;
	}

	.composer-control {
		display: inline-flex;
		align-items: center;
		gap: 0.42rem;
		min-height: 1.8rem;
		padding: 0.22rem 0.52rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 74%, transparent);
		border-radius: var(--ui-radius-sm);
		background: transparent;
		color: var(--ui-text-primary);
		font: inherit;
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
		letter-spacing: 0.04em;
		color: var(--ui-text-secondary);
	}

	.composer-control strong {
		font-size: 0.72rem;
		font-weight: 650;
		letter-spacing: -0.01em;
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
		padding: 0.72rem 0.8rem;
		border-radius: var(--ui-radius-md);
		border: 1px solid color-mix(in oklab, var(--ui-danger) 22%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-danger-soft) 74%, transparent);
		color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
		font-size: 0.78rem;
		line-height: 1.5;
	}

	:global(.composer-shell .ui-textarea) {
		min-height: 3.4rem;
	}

	.composer-usage {
		margin: 0;
		font-size: 0.66rem;
		font-family: var(--font-mono);
		color: var(--ui-text-tertiary);
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 760px) {
		.composer-shell {
			padding: 0.75rem;
		}

		.composer-foot,
		.composer-meta {
			align-items: flex-start;
			justify-content: flex-start;
		}

		.composer-actions {
			justify-content: flex-start;
		}
	}
</style>
