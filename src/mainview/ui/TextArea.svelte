<script lang="ts">
	import type { HTMLTextareaAttributes } from "svelte/elements";

	type Props = HTMLTextareaAttributes & {
		value?: string;
		resize?: "none" | "vertical";
	};

	let { value = $bindable(""), resize = "vertical", class: className = "", ...rest }: Props = $props();
</script>

<textarea {...rest} bind:value class={`ui-textarea resize-${resize} ${className}`.trim()}></textarea>

<style>
	.ui-textarea {
		width: 100%;
		min-height: 7.2rem;
		padding: 0.82rem 0.95rem;
		border-radius: calc(var(--ui-radius-md) + 0.16rem);
		border: 1px solid rgba(148, 163, 184, 0.34);
		background: rgba(255, 255, 255, 0.92);
		color: var(--ui-text-primary);
		line-height: 1.6;
		transition:
			border-color 140ms ease,
			box-shadow 140ms ease,
			background-color 140ms ease;
	}

	.ui-textarea::placeholder {
		color: rgba(71, 85, 105, 0.68);
	}

	.ui-textarea:hover {
		border-color: rgba(14, 116, 144, 0.28);
	}

	.ui-textarea:focus-visible {
		outline: none;
		border-color: rgba(14, 116, 144, 0.46);
		box-shadow: var(--ui-focus-ring);
		background: rgba(255, 255, 255, 0.98);
	}

	.resize-none {
		resize: none;
	}

	.resize-vertical {
		resize: vertical;
	}
</style>
