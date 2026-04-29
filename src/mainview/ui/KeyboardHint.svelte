<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";

	type Props = HTMLAttributes<HTMLElement> & {
		keys?: string | string[];
	};

	let { keys = "", class: className = "", ...rest }: Props = $props();
	const keyParts = $derived(Array.isArray(keys) ? keys : String(keys).split(/\s+/).filter(Boolean));
</script>

<kbd {...rest} class={`ui-keyboard-hint ${className}`.trim()} aria-label={keyParts.join(" ")}>
	{#each keyParts as key, index}
		<span>{key}</span>{#if index < keyParts.length - 1}<span class="joiner">+</span>{/if}
	{/each}
</kbd>

<style>
	.ui-keyboard-hint {
		display: inline-flex;
		align-items: center;
		gap: 0.18rem;
		color: var(--ui-text-tertiary);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		white-space: nowrap;
	}

	.ui-keyboard-hint span:not(.joiner) {
		min-width: 1.08rem;
		padding: 0.14rem 0.28rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
		border-bottom-color: color-mix(in oklab, var(--ui-border-strong) 82%, transparent);
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-surface-raised) 82%, transparent);
		text-align: center;
	}

	.joiner {
		color: var(--ui-text-tertiary);
	}
</style>
