<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	type MetadataTone = "neutral" | "info" | "accent" | "success" | "warning" | "danger";

	type Props = HTMLAttributes<HTMLSpanElement> & {
		label?: string;
		value?: string;
		tone?: MetadataTone;
		mono?: boolean;
		children?: Snippet;
	};

	let {
		label,
		value,
		tone = "neutral",
		mono = true,
		class: className = "",
		children,
		...rest
	}: Props = $props();
</script>

<span {...rest} class={`ui-metadata-chip tone-${tone} ${mono ? "mono" : ""} ${className}`.trim()}>
	{#if label}
		<span class="ui-metadata-label">{label}</span>
	{/if}
	<span class="ui-metadata-value">
		{#if children}
			{@render children()}
		{:else if value}
			{value}
		{/if}
	</span>
</span>

<style>
	.ui-metadata-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.28rem;
		max-width: 100%;
		min-height: 1.32rem;
		padding: 0.16rem 0.44rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-surface-muted) 76%, transparent);
		color: var(--ui-text-secondary);
		font-size: 0.66rem;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.mono {
		font-family: var(--font-mono);
	}

	.ui-metadata-label {
		color: var(--ui-text-tertiary);
	}

	.ui-metadata-value {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tone-info {
		border-color: color-mix(in oklab, var(--ui-info) 22%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-info-soft) 76%, transparent);
		color: color-mix(in oklab, var(--ui-info) 72%, var(--ui-text-primary));
	}

	.tone-accent {
		border-color: color-mix(in oklab, var(--ui-accent) 24%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-accent-soft) 78%, transparent);
		color: color-mix(in oklab, var(--ui-accent) 80%, var(--ui-text-primary));
	}

	.tone-success {
		border-color: color-mix(in oklab, var(--ui-success) 22%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-success-soft) 76%, transparent);
		color: color-mix(in oklab, var(--ui-success) 76%, var(--ui-text-primary));
	}

	.tone-warning {
		border-color: color-mix(in oklab, var(--ui-warning) 24%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-warning-soft) 78%, transparent);
		color: color-mix(in oklab, var(--ui-warning) 82%, var(--ui-text-primary));
	}

	.tone-danger {
		border-color: color-mix(in oklab, var(--ui-danger) 24%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-danger-soft) 78%, transparent);
		color: color-mix(in oklab, var(--ui-danger) 78%, var(--ui-text-primary));
	}
</style>
