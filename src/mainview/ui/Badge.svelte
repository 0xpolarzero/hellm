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
		min-height: 1.45rem;
		padding: 0.12rem 0.55rem;
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.tone-neutral {
		background: rgba(226, 232, 240, 0.86);
		color: #526072;
	}

	.tone-info {
		background: rgba(219, 234, 254, 0.92);
		color: #1d4ed8;
	}

	.tone-success {
		background: rgba(220, 252, 231, 0.92);
		color: #15803d;
	}

	.tone-warning {
		background: rgba(254, 243, 199, 0.94);
		color: #92400e;
	}

	.tone-danger {
		background: rgba(254, 226, 226, 0.94);
		color: #b91c1c;
	}
</style>
