<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	type FilterTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

	export type PaneFilterTabOption = {
		value: string;
		label: string;
		count?: number | null;
		tone?: FilterTone;
		ariaLabel?: string;
	};

	type Props = HTMLAttributes<HTMLDivElement> & {
		value: string;
		options: PaneFilterTabOption[];
		label?: string | null;
		showDots?: boolean;
		leading?: Snippet;
		onSelect: (value: string) => void;
	};

	let {
		value,
		options,
		label = null,
		showDots = false,
		leading,
		onSelect,
		class: className = "",
		...rest
	}: Props = $props();
</script>

<div {...rest} class={`ui-pane-filter-tabs ${className}`.trim()}>
	{#if label}
		<span class="ui-pane-filter-label">{label}</span>
	{/if}
	{#if leading}
		{@render leading()}
	{/if}
	{#each options as option (option.value)}
		{@const active = value === option.value}
		<button
			type="button"
			class={`ui-pane-filter-tab tone-${option.tone ?? "neutral"} ${active ? "active" : ""}`.trim()}
			aria-pressed={active}
			aria-label={option.ariaLabel}
			onclick={() => onSelect(option.value)}
		>
			{#if showDots}
				<span class="ui-pane-filter-dot" aria-hidden="true"></span>
			{/if}
			<span>{option.label}</span>
			{#if option.count !== undefined && option.count !== null}
				<strong>{option.count}</strong>
			{/if}
		</button>
	{/each}
</div>

<style>
	.ui-pane-filter-tabs {
		display: inline-flex;
		align-items: center;
		gap: 0.22rem;
		min-width: 0;
		padding: 0.18rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-surface) 90%, transparent);
		box-shadow: inset 0 1px 0 color-mix(in oklab, var(--ui-text-primary) 4%, transparent);
		overflow-x: auto;
	}

	.ui-pane-filter-label {
		flex: 0 0 auto;
		padding: 0 0.22rem 0 0.32rem;
		color: var(--ui-text-tertiary);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0;
		text-transform: uppercase;
	}

	.ui-pane-filter-tab {
		display: inline-flex;
		align-items: center;
		gap: 0.34rem;
		min-height: 1.58rem;
		padding: 0 0.42rem;
		border: 1px solid transparent;
		border-radius: var(--ui-radius-xs);
		background: color-mix(in oklab, var(--ui-surface-subtle) 34%, transparent);
		color: var(--ui-text-secondary);
		font: inherit;
		font-size: var(--text-xs);
		line-height: 1;
		cursor: pointer;
		white-space: nowrap;
		transition:
			border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
			color 150ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.ui-pane-filter-tab:hover {
		border-color: color-mix(in oklab, var(--ui-border-strong) 42%, transparent);
		background: color-mix(in oklab, var(--ui-surface-raised) 74%, transparent);
		color: var(--ui-text-primary);
	}

	.ui-pane-filter-tab:focus-visible {
		outline: none;
		box-shadow: var(--ui-focus-ring);
	}

	.ui-pane-filter-tab.active {
		border-color: color-mix(in oklab, var(--ui-border-accent) 62%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-accent-soft) 66%, var(--ui-surface));
		color: var(--ui-text-primary);
	}

	.ui-pane-filter-tab strong {
		min-width: 1.1rem;
		padding: 0.08rem 0.24rem;
		border-radius: var(--ui-radius-xs);
		background: color-mix(in oklab, var(--ui-code) 78%, transparent);
		color: var(--ui-text-tertiary);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}

	.ui-pane-filter-tab.active strong {
		background: color-mix(in oklab, var(--ui-surface-raised) 82%, transparent);
		color: var(--ui-text-primary);
	}

	.ui-pane-filter-dot {
		width: 0.42rem;
		height: 0.42rem;
		border: 1px solid currentColor;
		border-radius: 999px;
		background: currentColor;
		opacity: 0.72;
	}

	.tone-neutral .ui-pane-filter-dot {
		background: transparent;
		color: var(--ui-text-tertiary);
	}

	.tone-info .ui-pane-filter-dot {
		color: var(--ui-info);
	}

	.tone-success .ui-pane-filter-dot {
		color: var(--ui-success);
	}

	.tone-warning .ui-pane-filter-dot {
		color: var(--ui-warning);
	}

	.tone-danger .ui-pane-filter-dot {
		color: var(--ui-danger);
	}

	.tone-accent .ui-pane-filter-dot {
		color: var(--ui-accent);
	}

	.tone-warning.active {
		border-color: color-mix(in oklab, var(--ui-warning) 42%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-warning-soft) 58%, var(--ui-surface));
	}

	.tone-danger.active {
		border-color: color-mix(in oklab, var(--ui-danger) 42%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-danger-soft) 58%, var(--ui-surface));
	}
</style>
