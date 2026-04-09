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
		min-height: 1.5rem;
		padding: 0.15rem 0.58rem;
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 720;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		white-space: nowrap;
		border: 1px solid transparent;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		box-shadow: inset 0 1px 0 color-mix(in oklab, white 50%, transparent);
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
