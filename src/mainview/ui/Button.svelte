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
		gap: 0.38rem;
		border-radius: var(--ui-radius-md);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		background: color-mix(in oklab, var(--ui-surface-raised) 82%, transparent);
		color: var(--ui-text-primary);
		font-weight: 620;
		letter-spacing: -0.01em;
		line-height: 1;
		cursor: pointer;
		box-shadow: var(--ui-shadow-soft);
		transition:
			border-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			box-shadow 170ms cubic-bezier(0.19, 1, 0.22, 1);
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
		min-height: 1.95rem;
		padding: 0.18rem 0.62rem;
		font-size: 0.74rem;
	}

	.size-md {
		min-height: 2.15rem;
		padding: 0.28rem 0.78rem;
		font-size: 0.79rem;
	}

	.variant-primary {
		border-color: color-mix(in oklab, var(--ui-accent) 34%, var(--ui-accent-strong));
		background:
			linear-gradient(180deg, color-mix(in oklab, white 16%, var(--ui-accent)), var(--ui-accent-strong));
		color: var(--ui-accent-ink);
		box-shadow:
			0 1px 0 color-mix(in oklab, white 16%, transparent) inset,
			0 12px 26px -18px color-mix(in oklab, var(--ui-accent) 70%, transparent);
	}

	.variant-primary:hover:not(:disabled) {
		border-color: color-mix(in oklab, var(--ui-accent) 46%, var(--ui-accent-strong));
		background:
			linear-gradient(180deg, color-mix(in oklab, white 22%, var(--ui-accent)), var(--ui-accent));
	}

	.variant-secondary {
		background: color-mix(in oklab, var(--ui-surface-raised) 86%, transparent);
		border-color: color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		color: var(--ui-text-primary);
	}

	.variant-secondary:hover:not(:disabled) {
		border-color: color-mix(in oklab, var(--ui-border-strong) 76%, transparent);
		background: color-mix(in oklab, var(--ui-surface) 82%, transparent);
	}

	.variant-ghost {
		background: transparent;
		border-color: transparent;
		color: var(--ui-text-secondary);
		box-shadow: none;
	}

	.variant-ghost:hover:not(:disabled) {
		background: color-mix(in oklab, var(--ui-surface-subtle) 78%, transparent);
		color: var(--ui-text-primary);
		box-shadow: none;
	}

	.variant-success {
		background: color-mix(in oklab, var(--ui-success-soft) 74%, transparent);
		border-color: color-mix(in oklab, var(--ui-success) 24%, var(--ui-border-soft));
		color: color-mix(in oklab, var(--ui-success) 84%, var(--ui-text-primary));
	}

	.variant-danger {
		background: color-mix(in oklab, var(--ui-danger-soft) 74%, transparent);
		border-color: color-mix(in oklab, var(--ui-danger) 22%, var(--ui-border-soft));
		color: color-mix(in oklab, var(--ui-danger) 86%, var(--ui-text-primary));
	}

	@media (max-width: 760px) {
		.size-sm,
		.size-md {
			min-height: 2.1rem;
		}
	}
</style>
