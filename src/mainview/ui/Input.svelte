<script lang="ts">
	import type { HTMLInputAttributes } from "svelte/elements";

	type Props = HTMLInputAttributes & {
		value?: string;
		mono?: boolean;
	};

	let { value = $bindable(""), mono = false, class: className = "", ...rest }: Props = $props();
</script>

<input {...rest} bind:value class={`ui-input ${mono ? "mono" : ""} ${className}`.trim()} />

<style>
	.ui-input {
		width: 100%;
		min-height: 1.95rem;
		padding: 0.28rem 0.58rem;
		border-radius: var(--ui-radius-sm);
		border: 1px solid var(--ui-border-soft);
		background: color-mix(in oklab, var(--ui-surface-raised) 74%, transparent);
		color: var(--ui-text-primary);
		font-size: 0.76rem;
		line-height: 1.4;
		box-shadow: none;
		transition:
			border-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			box-shadow 170ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 170ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.ui-input::placeholder {
		color: var(--ui-text-tertiary);
	}

	.ui-input:hover {
		border-color: color-mix(in oklab, var(--ui-accent) 22%, var(--ui-border-strong));
	}

	.ui-input:focus-visible {
		outline: none;
		border-color: color-mix(in oklab, var(--ui-accent) 58%, var(--ui-border-strong));
		box-shadow: var(--ui-focus-ring);
		background: var(--ui-bg-elevated);
	}

	.ui-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.mono {
		font-family: var(--font-mono);
		font-size: 0.74rem;
	}
</style>
