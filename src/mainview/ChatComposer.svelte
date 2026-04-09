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
			<span class="toolbar-label">Window</span>
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
		placeholder="Ask hellm to inspect, change, or verify the project."
		onkeydown={handleKeydown}
	/>

	<div class="composer-footer">
		<p>{usageText || "Enter sends. Shift+Enter keeps writing."}</p>
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
		padding: 1rem 1.1rem 1.1rem;
		border-top: 1px solid rgba(203, 213, 225, 0.82);
		background:
			linear-gradient(180deg, rgba(248, 250, 252, 0.84), rgba(255, 255, 255, 0.96)),
			radial-gradient(circle at bottom left, rgba(45, 212, 191, 0.08), transparent 35%);
	}

	.composer-toolbar {
		display: grid;
		grid-template-columns: minmax(0, 1.5fr) minmax(11rem, 0.8fr) auto;
		gap: 0.75rem;
		margin-bottom: 0.85rem;
	}

	.model-pill,
	.thinking-field,
	.context-chip {
		display: grid;
		gap: 0.2rem;
		padding: 0.7rem 0.85rem;
		border-radius: calc(var(--ui-radius-md) + 0.12rem);
		border: 1px solid rgba(148, 163, 184, 0.28);
		background: rgba(255, 255, 255, 0.78);
	}

	.model-pill {
		text-align: left;
		cursor: pointer;
		transition:
			transform 140ms ease,
			border-color 140ms ease,
			background-color 140ms ease;
	}

	.model-pill:hover {
		transform: translateY(-1px);
		border-color: rgba(14, 116, 144, 0.34);
		background: rgba(255, 255, 255, 0.94);
	}

	.model-pill:focus-visible {
		outline: none;
		box-shadow: var(--ui-focus-ring);
	}

	.toolbar-label {
		font-size: 0.68rem;
		font-weight: 760;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ui-accent-strong);
	}

	.model-pill strong,
	.context-chip strong {
		font-size: 0.93rem;
		font-weight: 730;
		color: var(--ui-text-primary);
	}

	.toolbar-meta {
		font-size: 0.78rem;
		color: var(--ui-text-secondary);
	}

	.thinking-field {
		min-width: 0;
	}

	.thinking-field select {
		min-width: 0;
		border: none;
		background: transparent;
		font: inherit;
		color: var(--ui-text-primary);
	}

	.thinking-field select:focus-visible {
		outline: none;
	}

	.context-chip {
		align-content: center;
		min-width: 0;
	}

	.composer-error {
		margin: 0 0 0.75rem;
		padding: 0.72rem 0.86rem;
		border-radius: calc(var(--ui-radius-md) + 0.08rem);
		background: rgba(254, 242, 242, 0.94);
		color: #b91c1c;
		font-size: 0.84rem;
		line-height: 1.5;
	}

	.composer-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		margin-top: 0.8rem;
	}

	.composer-footer p {
		margin: 0;
		font-size: 0.78rem;
		color: var(--ui-text-secondary);
	}

	.composer-actions {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	@media (max-width: 900px) {
		.composer-toolbar {
			grid-template-columns: 1fr;
		}

		.context-chip {
			width: fit-content;
		}
	}

	@media (max-width: 640px) {
		.composer-shell {
			padding: 0.9rem;
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
