<script lang="ts">
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
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
	import Button from "./ui/Button.svelte";
	import TextArea from "./ui/TextArea.svelte";

	type Props = {
		currentModel: Model<any>;
		thinkingLevel: ThinkingLevel;
		isStreaming: boolean;
		promptHistory: PromptHistoryEntry[];
		errorMessage?: string;
		usageText?: string;
		onAbort: () => void;
		onOpenModelPicker: () => void;
		onSend: (input: string) => Promise<boolean> | boolean;
		onThinkingChange: (level: ThinkingLevel) => void;
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
	}: Props = $props();

	let draft = $state("");
	let isSubmitting = $state(false);
	let showThinkingMenu = $state(false);
	let draftElement = $state<HTMLTextAreaElement | null>(null);
	let thinkingMenuRoot = $state<HTMLDivElement | null>(null);
	let historyNavigation = $state<PromptHistoryNavigationState>(createPromptHistoryNavigationState());

	const availableThinkingLevels = $derived(
		supportsXhigh(currentModel) ? [...BASE_LEVELS, "xhigh"] : BASE_LEVELS,
	);

	onMount(() => {
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (thinkingMenuRoot?.contains(target)) return;
			showThinkingMenu = false;
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				showThinkingMenu = false;
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
		const nextDraft = draft;
		draft = "";
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
				higherPriorityUiActive: showThinkingMenu,
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
			rows={5}
			placeholder="Ask hellm to inspect the repo, make a change, or run verification."
			onkeydown={handleKeydown}
		/>

		<div class="composer-foot">
			<div class="composer-controls">
				<button class="composer-control model-control" type="button" onclick={() => onOpenModelPicker()}>
					<span class="composer-control-label">Model</span>
					<strong>{currentModel.name}</strong>
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
						<Button variant="primary" size="sm" onclick={() => void submit()} disabled={!draft.trim() || isSubmitting}>
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
		padding: 0.95rem;
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
		min-height: 6.8rem;
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
