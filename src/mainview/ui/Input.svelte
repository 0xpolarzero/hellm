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
		min-height: 2.4rem;
		padding: 0.58rem 0.78rem;
		border-radius: calc(var(--ui-radius-md) + 0.08rem);
		border: 1px solid rgba(148, 163, 184, 0.34);
		background: rgba(255, 255, 255, 0.9);
		color: var(--ui-text-primary);
		transition:
			border-color 140ms ease,
			box-shadow 140ms ease,
			background-color 140ms ease;
	}

	.ui-input::placeholder {
		color: rgba(71, 85, 105, 0.68);
	}

	.ui-input:hover {
		border-color: rgba(14, 116, 144, 0.28);
	}

	.ui-input:focus-visible {
		outline: none;
		border-color: rgba(14, 116, 144, 0.46);
		box-shadow: var(--ui-focus-ring);
		background: rgba(255, 255, 255, 0.96);
	}

	.ui-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.mono {
		font-family: "SF Mono", "Menlo", monospace;
		font-size: 0.85rem;
	}
</style>
