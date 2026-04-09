<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";

	type ButtonVariant = "primary" | "secondary" | "ghost" | "success" | "danger";
	type ButtonSize = "sm" | "md";

	type Props = HTMLButtonAttributes & {
		variant?: ButtonVariant;
		size?: ButtonSize;
		children?: Snippet;
	};

	let {
		variant = "secondary",
		size = "md",
		type = "button",
		class: className = "",
		children,
		...rest
	}: Props = $props();
</script>

<button {...rest} type={type} class={`ui-button variant-${variant} size-${size} ${className}`.trim()}>
	{#if children}
		{@render children()}
	{/if}
</button>

<style>
	.ui-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		border-radius: var(--ui-radius-sm);
		border: 1px solid var(--ui-border-soft);
		background: color-mix(in oklab, var(--ui-surface-subtle) 72%, transparent);
		color: var(--ui-text-primary);
		font-weight: 620;
		letter-spacing: 0.01em;
		line-height: 1;
		cursor: pointer;
		box-shadow: none;
		transition:
			border-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			color 170ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.ui-button:focus-visible {
		outline: none;
		box-shadow: var(--ui-focus-ring);
	}

	.ui-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		box-shadow: none;
	}

	.size-sm {
		min-height: 1.78rem;
		padding: 0.18rem 0.52rem;
		font-size: 0.74rem;
	}

	.size-md {
		min-height: 2rem;
		padding: 0.24rem 0.62rem;
		font-size: 0.79rem;
	}

	.variant-primary {
		border-color: color-mix(in oklab, var(--ui-accent) 34%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-accent-soft) 64%, var(--ui-bg-elevated));
		color: color-mix(in oklab, var(--ui-accent-strong) 88%, var(--ui-text-primary));
		box-shadow: none;
	}

	.variant-primary:hover:not(:disabled) {
		border-color: color-mix(in oklab, var(--ui-accent) 48%, var(--ui-border-strong));
		background: color-mix(in oklab, var(--ui-accent-soft) 84%, var(--ui-bg-elevated));
	}

	.variant-secondary {
		background: color-mix(in oklab, var(--ui-surface-subtle) 68%, transparent);
		border-color: color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		color: var(--ui-text-primary);
	}

	.variant-secondary:hover:not(:disabled) {
		border-color: color-mix(in oklab, var(--ui-border-strong) 76%, transparent);
		background: var(--ui-bg-elevated);
	}

	.variant-ghost {
		background: transparent;
		border-color: transparent;
		color: var(--ui-text-secondary);
		box-shadow: none;
	}

	.variant-ghost:hover:not(:disabled) {
		background: color-mix(in oklab, var(--ui-surface-subtle) 58%, transparent);
		color: var(--ui-text-primary);
	}

	.variant-success {
		background: var(--ui-success-soft);
		border-color: color-mix(in oklab, var(--ui-success) 30%, var(--ui-border-soft));
		color: color-mix(in oklab, var(--ui-success) 84%, var(--ui-text-primary));
	}

	.variant-danger {
		background: var(--ui-danger-soft);
		border-color: color-mix(in oklab, var(--ui-danger) 28%, var(--ui-border-soft));
		color: color-mix(in oklab, var(--ui-danger) 86%, var(--ui-text-primary));
	}

	@media (max-width: 720px) {
		.size-sm,
		.size-md {
			min-height: 2rem;
		}
	}
</style>
