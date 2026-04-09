<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

	type Props = HTMLAttributes<HTMLSpanElement> & {
		tone?: BadgeTone;
		children?: Snippet;
	};

	let { tone = "neutral", class: className = "", children, ...rest }: Props = $props();
</script>

<span {...rest} class={`ui-badge tone-${tone} ${className}`.trim()}>
	{#if children}
		{@render children()}
	{/if}
</span>

<style>
	.ui-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 1.1rem;
		padding: 0.08rem 0.34rem;
		border-radius: var(--ui-radius-sm);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		white-space: nowrap;
		border: 1px solid transparent;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		box-shadow: none;
	}

	.tone-neutral {
		background: color-mix(in oklab, var(--ui-surface-muted) 88%, transparent);
		border-color: color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		color: var(--ui-text-secondary);
	}

	.tone-info {
		background: var(--ui-info-soft);
		border-color: color-mix(in oklab, var(--ui-info) 26%, var(--ui-border-soft));
		color: color-mix(in oklab, var(--ui-info) 75%, var(--ui-text-primary));
	}

	.tone-success {
		background: var(--ui-success-soft);
		border-color: color-mix(in oklab, var(--ui-success) 28%, var(--ui-border-soft));
		color: color-mix(in oklab, var(--ui-success) 78%, var(--ui-text-primary));
	}

	.tone-warning {
		background: var(--ui-warning-soft);
		border-color: color-mix(in oklab, var(--ui-warning) 26%, var(--ui-border-soft));
		color: color-mix(in oklab, var(--ui-warning) 82%, var(--ui-text-primary));
	}

	.tone-danger {
		background: var(--ui-danger-soft);
		border-color: color-mix(in oklab, var(--ui-danger) 28%, var(--ui-border-soft));
		color: color-mix(in oklab, var(--ui-danger) 80%, var(--ui-text-primary));
	}
</style>
