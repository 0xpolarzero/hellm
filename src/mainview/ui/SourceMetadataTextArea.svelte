<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLTextareaAttributes } from "svelte/elements";
	import type { PreferredExternalEditor } from "../../shared/agent-settings";
	import OpenExternalButton from "./OpenExternalButton.svelte";

	type Props = Omit<HTMLTextareaAttributes, "class" | "children"> & {
		value?: string;
		status?: string | null;
		statusOverlay?: Snippet;
		footerLeading?: Snippet;
		showTokenCount?: boolean;
		tokenCountLabel?: string | null;
		sourceLabel: string;
		sourceDisabled?: boolean;
		sourceEditor?: PreferredExternalEditor | null;
		onOpenSource: () => void;
	};

	let {
		value = $bindable(""),
		status = null,
		statusOverlay,
		footerLeading,
		showTokenCount = true,
		tokenCountLabel = null,
		sourceLabel,
		sourceDisabled = false,
		sourceEditor = null,
		onOpenSource,
		...rest
	}: Props = $props();
</script>

<div class="source-metadata-textarea" data-status={status}>
	<div class="source-metadata-textarea-input-shell">
		<textarea
			{...rest}
			bind:value
			class="source-metadata-textarea-input"
		></textarea>
		{#if statusOverlay}
			<div class="source-metadata-textarea-overlay">
				{@render statusOverlay()}
			</div>
		{/if}
	</div>
	<div class="source-metadata-textarea-footer">
		<span class="source-metadata-textarea-footer-start">
			{#if footerLeading}
				{@render footerLeading()}
			{/if}
			{#if showTokenCount && tokenCountLabel}
				<span class="source-metadata-textarea-token-count">
					{tokenCountLabel}
				</span>
			{/if}
		</span>
		<span class="source-metadata-textarea-source-target">
			<span class="source-metadata-textarea-source-filename">{sourceLabel}</span>
			<OpenExternalButton
				class="source-metadata-textarea-source-button"
				editor={sourceEditor}
				targetLabel={sourceLabel}
				disabled={sourceDisabled}
				onclick={onOpenSource}
			/>
		</span>
	</div>
</div>

<style>
	.source-metadata-textarea {
		display: grid;
		gap: 0;
		min-width: 0;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-bg-elevated) 84%, transparent);
		transition:
			border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
			box-shadow 150ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.source-metadata-textarea:hover,
	.source-metadata-textarea:focus-within {
		border-color: color-mix(in oklab, var(--ui-accent) 36%, var(--ui-border-soft));
		box-shadow: var(--ui-focus-ring);
	}

	.source-metadata-textarea-input-shell {
		position: relative;
	}

	.source-metadata-textarea-input {
		box-sizing: border-box;
		width: 100%;
		min-height: 4rem;
		resize: vertical;
		padding: 0.42rem 2rem 0.16rem 0.5rem;
		border: 0;
		background: transparent;
		color: var(--ui-text-primary);
		font: inherit;
		font-size: var(--text-sm);
		line-height: 1.45;
	}

	.source-metadata-textarea-input:hover,
	.source-metadata-textarea-input:focus-visible {
		outline: none;
	}

	.source-metadata-textarea-input:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.source-metadata-textarea-overlay {
		position: absolute;
		top: 0.36rem;
		right: 0.36rem;
	}

	.source-metadata-textarea-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.36rem;
		min-width: 0;
		min-height: 1.08rem;
		padding: 0 0.36rem 0.22rem 0.5rem;
		color: var(--ui-text-tertiary);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1;
	}

	.source-metadata-textarea-footer-start {
		display: inline-flex;
		align-items: center;
		gap: 0.32rem;
		flex: 0 1 auto;
		min-width: 0;
	}

	.source-metadata-textarea-token-count {
		flex: 0 0 auto;
		color: var(--ui-text-secondary);
		font-weight: 600;
		white-space: nowrap;
	}

	.source-metadata-textarea-source-target {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.36rem;
		margin-left: auto;
		min-width: 0;
	}

	.source-metadata-textarea-source-filename {
		display: inline-flex;
		align-items: center;
		min-width: 0;
		min-height: 1.24rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.source-metadata-textarea-footer :global(.ui-tooltip-anchor) {
		align-items: center;
		height: 1.24rem;
	}
</style>
