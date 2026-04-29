<script lang="ts">
	import type { HTMLTextareaAttributes } from "svelte/elements";

	type Props = HTMLTextareaAttributes & {
		value?: string;
		resize?: "none" | "vertical";
		element?: HTMLTextAreaElement | null;
	};

	let {
		value = $bindable(""),
		resize = "vertical",
		element = $bindable(null),
		class: className = "",
		...rest
	}: Props = $props();
</script>

<textarea {...rest} bind:this={element} bind:value class={`ui-textarea resize-${resize} ${className}`.trim()}></textarea>

<style>
	.ui-textarea {
		width: 100%;
		min-height: 5.25rem;
		padding: 0.56rem 0.62rem;
		border-radius: var(--ui-radius-sm);
		border: 1px solid var(--ui-border-soft);
		background: color-mix(in oklab, var(--ui-surface-raised) 74%, transparent);
		color: var(--ui-text-primary);
		font-size: 0.78rem;
		line-height: 1.5;
		box-shadow: none;
		transition:
			border-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			box-shadow 170ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 170ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.ui-textarea::placeholder {
		color: var(--ui-text-tertiary);
	}

	.ui-textarea:hover {
		border-color: color-mix(in oklab, var(--ui-accent) 22%, var(--ui-border-strong));
	}

	.ui-textarea:focus-visible {
		outline: none;
		border-color: color-mix(in oklab, var(--ui-accent) 58%, var(--ui-border-strong));
		box-shadow: var(--ui-focus-ring);
		background: var(--ui-bg-elevated);
	}

	.ui-textarea:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.resize-none {
		resize: none;
	}

	.resize-vertical {
		resize: vertical;
	}
</style>
