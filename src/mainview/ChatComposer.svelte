<script lang="ts">
	import { supportsXhigh, type Model } from "@mariozechner/pi-ai";
	import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
	import { formatModelCost, formatTokenCount } from "./chat-format";
	import Button from "./ui/Button.svelte";
	import TextArea from "./ui/TextArea.svelte";

	type Props = {
		currentModel: Model<any>;
		thinkingLevel: ThinkingLevel;
		isStreaming: boolean;
		errorMessage?: string;
		usageText?: string;
		onAbort: () => void;
		onOpenModelPicker: () => void | Promise<void>;
		onSend: (input: string) => Promise<boolean> | boolean;
		onThinkingChange: (level: ThinkingLevel) => void;
	};

	const BASE_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

	let {
		currentModel,
		thinkingLevel,
		isStreaming,
		errorMessage,
		usageText,
		onAbort,
		onOpenModelPicker,
		onSend,
		onThinkingChange,
	}: Props = $props();

	let draft = $state("");

	const availableThinkingLevels = $derived(
		supportsXhigh(currentModel) ? [...BASE_LEVELS, "xhigh"] : BASE_LEVELS,
	);

	async function submit() {
		if (!draft.trim() || isStreaming) return;
		const nextDraft = draft;
		const sent = await onSend(nextDraft);
		if (sent) {
			draft = "";
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
		event.preventDefault();
		void submit();
	}
</script>

<div class="composer-shell">
	<div class="composer-toolbar">
		<button class="model-pill" type="button" onclick={() => onOpenModelPicker()}>
			<span class="toolbar-label">Model</span>
			<strong>{currentModel.name}</strong>
			<span class="toolbar-meta">{currentModel.provider} · {formatModelCost(currentModel)}</span>
		</button>

		<label class="thinking-field">
			<span class="toolbar-label">Thinking</span>
			<select
				value={thinkingLevel}
				onchange={(event) => onThinkingChange((event.currentTarget as HTMLSelectElement).value as ThinkingLevel)}
			>
				{#each availableThinkingLevels as level}
					<option value={level}>{level}</option>
				{/each}
			</select>
		</label>

		<div class="context-chip">
			<span class="toolbar-label">Context</span>
			<strong>{formatTokenCount(currentModel.contextWindow)}</strong>
		</div>
	</div>

	{#if errorMessage}
		<p class="composer-error">{errorMessage}</p>
	{/if}

	<TextArea
		bind:value={draft}
		resize="vertical"
		rows={5}
		placeholder="Ask hellm to inspect the repo, make a change, or run verification."
		onkeydown={handleKeydown}
	/>

	<div class="composer-footer">
		<p>{usageText ? `Session ${usageText}` : "Enter sends. Shift+Enter keeps writing."}</p>
		<div class="composer-actions">
			{#if isStreaming}
				<Button variant="danger" onclick={onAbort}>Stop</Button>
			{:else}
				<Button variant="primary" onclick={() => void submit()} disabled={!draft.trim()}>Send</Button>
			{/if}
		</div>
	</div>
</div>

<style>
	.composer-shell {
		container-type: inline-size;
		padding: 0.7rem 0.8rem 0.8rem;
		border-top: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		background: var(--ui-surface);
	}

	.composer-toolbar {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(11rem, 0.82fr) minmax(8rem, auto);
		gap: 0.75rem;
		margin-bottom: 0.7rem;
	}

	.model-pill,
	.thinking-field,
	.context-chip {
		display: grid;
		gap: 0.24rem;
		padding: 0.1rem 0 0.55rem;
		border-radius: 0;
		border: none;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
		background: transparent;
	}

	.model-pill {
		text-align: left;
		cursor: pointer;
		transition:
			border-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 170ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.model-pill:hover {
		transform: none;
		border-color: color-mix(in oklab, var(--ui-accent) 28%, var(--ui-border-strong));
		background: transparent;
		box-shadow: none;
	}

	.model-pill:focus-visible {
		outline: none;
		box-shadow: var(--ui-focus-ring);
	}

	.toolbar-label {
		font-size: 0.62rem;
		font-weight: 760;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ui-accent-strong);
	}

	.model-pill strong,
	.context-chip strong {
		font-size: 0.88rem;
		font-weight: 710;
		letter-spacing: -0.025em;
		color: var(--ui-text-primary);
	}

	.toolbar-meta {
		font-size: 0.72rem;
		color: var(--ui-text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.thinking-field {
		min-width: 0;
	}

	.thinking-field select {
		min-width: 0;
		padding: 0;
		border: none;
		background: transparent;
		font: inherit;
		color: var(--ui-text-primary);
		font-weight: 650;
		appearance: none;
		cursor: pointer;
	}

	.thinking-field select:focus-visible {
		outline: none;
	}

	.context-chip {
		align-content: center;
		min-width: 0;
		font-variant-numeric: tabular-nums;
	}

	.composer-error {
		margin: 0 0 0.75rem;
		padding: 0.65rem 0.75rem;
		border-radius: 0;
		border: none;
		border-left: 2px solid var(--ui-danger);
		background: color-mix(in oklab, var(--ui-danger-soft) 76%, transparent);
		color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
		font-size: 0.84rem;
		line-height: 1.5;
	}

	:global(.composer-shell .ui-textarea) {
		min-height: 7.25rem;
	}

	.composer-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		margin-top: 0.65rem;
		padding-top: 0.65rem;
		border-top: 1px solid color-mix(in oklab, var(--ui-border-soft) 56%, transparent);
	}

	.composer-footer p {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ui-text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.composer-actions {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	@container (max-width: 44rem) {
		.composer-toolbar {
			grid-template-columns: 1fr;
		}

		.context-chip {
			width: fit-content;
		}
	}

	@media (max-width: 640px) {
		.composer-shell {
			padding: 0.65rem;
		}

		.composer-footer {
			flex-direction: column;
			align-items: stretch;
		}

		.composer-actions {
			justify-content: flex-end;
		}
	}
</style>
