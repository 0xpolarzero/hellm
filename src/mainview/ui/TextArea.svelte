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
		min-height: 6.4rem;
		padding: 0.88rem 0.92rem;
		border-radius: var(--ui-radius-md);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-surface-raised) 84%, transparent), transparent),
			color-mix(in oklab, var(--ui-surface-raised) 92%, transparent);
		color: var(--ui-text-primary);
		font-size: 0.86rem;
		line-height: 1.58;
		box-shadow: var(--ui-shadow-soft);
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

	.resize-none {
		resize: none;
	}

	.resize-vertical {
		resize: vertical;
	}
</style>
