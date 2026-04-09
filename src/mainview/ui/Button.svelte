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
		gap: 0.5rem;
		border-radius: var(--ui-radius-sm);
		border: 1px solid var(--ui-border-soft);
		background: var(--ui-surface-subtle);
		color: var(--ui-text-primary);
		font-weight: 660;
		letter-spacing: 0.014em;
		line-height: 1;
		cursor: pointer;
		box-shadow: none;
		transition:
			transform 170ms cubic-bezier(0.19, 1, 0.22, 1),
			box-shadow 170ms cubic-bezier(0.19, 1, 0.22, 1),
			border-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			color 170ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.ui-button:hover:not(:disabled) {
		transform: translateY(-1px);
	}

	.ui-button:focus-visible {
		outline: none;
		box-shadow: var(--ui-focus-ring);
	}

	.ui-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}

	.size-sm {
		min-height: 2.25rem;
		padding: 0.48rem 0.82rem;
		font-size: 0.78rem;
	}

	.size-md {
		min-height: 2.8rem;
		padding: 0.68rem 1.02rem;
		font-size: 0.89rem;
	}

	.variant-primary {
		border-color: color-mix(in oklab, var(--ui-accent-strong) 72%, var(--ui-border-strong));
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-accent) 88%, white 12%), var(--ui-accent-strong));
		color: oklch(0.18 0.012 58);
		box-shadow: none;
	}

	.variant-primary:hover:not(:disabled) {
		box-shadow: none;
	}

	.variant-secondary {
		background: var(--ui-surface-subtle);
		border-color: var(--ui-border-strong);
		color: var(--ui-text-primary);
	}

	.variant-secondary:hover:not(:disabled) {
		border-color: color-mix(in oklab, var(--ui-accent) 24%, var(--ui-border-strong));
		background: var(--ui-bg-elevated);
	}

	.variant-ghost {
		background: transparent;
		border-color: transparent;
		color: var(--ui-text-secondary);
		box-shadow: none;
	}

	.variant-ghost:hover:not(:disabled) {
		background: color-mix(in oklab, var(--ui-surface-subtle) 82%, transparent);
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

	.ui-button:active:not(:disabled) {
		transform: translateY(0);
	}

	@media (max-width: 720px) {
		.size-sm,
		.size-md {
			min-height: 2.75rem;
		}
	}
</style>
