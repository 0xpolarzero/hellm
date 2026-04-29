<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLButtonAttributes, HTMLAttributes } from "svelte/elements";

	type DenseRowTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

	type Props = HTMLAttributes<HTMLDivElement> &
		HTMLButtonAttributes & {
			as?: "div" | "button";
			tone?: DenseRowTone;
			active?: boolean;
			disabled?: boolean;
			leading?: Snippet;
			meta?: Snippet;
			actions?: Snippet;
			children?: Snippet;
		};

	let {
		as = "div",
		tone = "neutral",
		active = false,
		disabled = false,
		leading,
		meta,
		actions,
		children,
		class: className = "",
		...rest
	}: Props = $props();
</script>

{#if as === "button"}
	<button
		{...rest}
		type={rest.type ?? "button"}
		{disabled}
		class={`ui-dense-row tone-${tone} ${active ? "active" : ""} ${className}`.trim()}
	>
		{#if leading}
			<span class="ui-dense-row-leading">
				{@render leading()}
			</span>
		{/if}
		<span class="ui-dense-row-body">
			{#if children}
				{@render children()}
			{/if}
		</span>
		{#if meta}
			<span class="ui-dense-row-meta">
				{@render meta()}
			</span>
		{/if}
		{#if actions}
			<span class="ui-dense-row-actions">
				{@render actions()}
			</span>
		{/if}
	</button>
{:else}
	<div
		{...rest}
		aria-disabled={disabled || undefined}
		class={`ui-dense-row tone-${tone} ${active ? "active" : ""} ${disabled ? "disabled" : ""} ${className}`.trim()}
	>
		{#if leading}
			<span class="ui-dense-row-leading">
				{@render leading()}
			</span>
		{/if}
		<span class="ui-dense-row-body">
			{#if children}
				{@render children()}
			{/if}
		</span>
		{#if meta}
			<span class="ui-dense-row-meta">
				{@render meta()}
			</span>
		{/if}
		{#if actions}
			<span class="ui-dense-row-actions">
				{@render actions()}
			</span>
		{/if}
	</div>
{/if}

<style>
	.ui-dense-row {
		--row-tone: transparent;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		min-height: 2rem;
		padding: 0.34rem 0.48rem;
		border: 1px solid transparent;
		border-left: 2px solid transparent;
		border-radius: var(--ui-radius-md);
		background: transparent;
		color: inherit;
		text-align: left;
		transition:
			background-color 160ms cubic-bezier(0.19, 1, 0.22, 1),
			border-color 160ms cubic-bezier(0.19, 1, 0.22, 1),
			color 160ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	button.ui-dense-row {
		cursor: pointer;
	}

	.ui-dense-row:hover:not(:disabled):not(.disabled),
	.ui-dense-row.active {
		border-color: color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		border-left-color: var(--row-tone);
		background: color-mix(in oklab, var(--ui-surface-subtle) 82%, transparent);
	}

	.ui-dense-row:focus-visible {
		outline: none;
		box-shadow: var(--ui-focus-ring);
	}

	.ui-dense-row:disabled,
	.ui-dense-row.disabled {
		opacity: 0.56;
		cursor: not-allowed;
	}

	.tone-neutral {
		--row-tone: var(--ui-border-strong);
	}

	.tone-accent {
		--row-tone: var(--ui-accent);
	}

	.tone-success {
		--row-tone: var(--ui-success);
	}

	.tone-warning {
		--row-tone: var(--ui-warning);
	}

	.tone-danger {
		--row-tone: var(--ui-danger);
	}

	.tone-info {
		--row-tone: var(--ui-info);
	}

	.ui-dense-row-leading,
	.ui-dense-row-meta,
	.ui-dense-row-actions {
		display: inline-flex;
		align-items: center;
		min-width: 0;
	}

	.ui-dense-row-body {
		min-width: 0;
		overflow: hidden;
	}

	.ui-dense-row-meta {
		gap: 0.3rem;
		color: var(--ui-text-tertiary);
		font-family: var(--font-mono);
		font-size: 0.66rem;
	}

	.ui-dense-row-actions {
		gap: 0.24rem;
	}
</style>
