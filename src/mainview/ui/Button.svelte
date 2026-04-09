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
		gap: 0.45rem;
		border-radius: 999px;
		border: 1px solid transparent;
		font-weight: 650;
		letter-spacing: 0.01em;
		cursor: pointer;
		transition:
			transform 140ms ease,
			box-shadow 140ms ease,
			border-color 140ms ease,
			background-color 140ms ease,
			color 140ms ease;
	}

	.ui-button:hover:not(:disabled) {
		transform: translateY(-1px);
	}

	.ui-button:focus-visible {
		outline: none;
		box-shadow: var(--ui-focus-ring);
	}

	.ui-button:disabled {
		opacity: 0.56;
		cursor: not-allowed;
		transform: none;
	}

	.size-sm {
		min-height: 2rem;
		padding: 0.38rem 0.8rem;
		font-size: 0.79rem;
	}

	.size-md {
		min-height: 2.45rem;
		padding: 0.58rem 1rem;
		font-size: 0.88rem;
	}

	.variant-primary {
		background: linear-gradient(135deg, var(--ui-accent-strong), var(--ui-accent));
		color: var(--ui-text-inverse);
		box-shadow: 0 14px 30px rgba(14, 116, 144, 0.18);
	}

	.variant-primary:hover:not(:disabled) {
		box-shadow: 0 18px 38px rgba(14, 116, 144, 0.24);
	}

	.variant-secondary {
		background: rgba(255, 255, 255, 0.86);
		border-color: var(--ui-border-strong);
		color: var(--ui-text-primary);
	}

	.variant-secondary:hover:not(:disabled) {
		border-color: rgba(94, 116, 144, 0.42);
		background: rgba(255, 255, 255, 0.96);
	}

	.variant-ghost {
		background: transparent;
		border-color: transparent;
		color: var(--ui-text-secondary);
	}

	.variant-ghost:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.82);
		color: var(--ui-text-primary);
	}

	.variant-success {
		background: rgba(236, 253, 245, 0.96);
		border-color: rgba(110, 231, 183, 0.7);
		color: #166534;
	}

	.variant-danger {
		background: rgba(254, 242, 242, 0.96);
		border-color: rgba(252, 165, 165, 0.72);
		color: #b91c1c;
	}
</style>
