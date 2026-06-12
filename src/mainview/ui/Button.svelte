<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import Kbd from "./Kbd.svelte";

	type ButtonVariant = "primary" | "secondary" | "ghost" | "success" | "danger";
	type ButtonSize = "xs" | "sm" | "md";
	type ButtonShortcutVisibility = "always" | "hover" | "none";

	type Props = HTMLButtonAttributes & {
		variant?: ButtonVariant;
		size?: ButtonSize;
		iconOnly?: boolean;
		loading?: boolean;
		shortcut?: string | null;
		shortcutVisibility?: ButtonShortcutVisibility;
		children?: Snippet;
	};

	let {
		variant = "secondary",
		size = "md",
		iconOnly = false,
		loading = false,
		shortcut = null,
		shortcutVisibility = "none",
		type = "button",
		class: className = "",
		children,
		...rest
	}: Props = $props();

	const hasHoverShortcut = $derived(Boolean(shortcut) && shortcutVisibility === "hover");
	const hasInlineShortcut = $derived(Boolean(shortcut) && shortcutVisibility === "always");
</script>

<button
	{...rest}
	type={type}
	aria-busy={loading || undefined}
	class={`ui-button variant-${variant} size-${size} ${iconOnly ? "icon-only" : ""} ${loading ? "is-loading" : ""} ${hasHoverShortcut ? "has-hover-shortcut" : ""} ${hasInlineShortcut ? "has-inline-shortcut" : ""} ${className}`.trim()}
>
	{#if loading}
		<span class="ui-button-spinner" aria-hidden="true"></span>
	{/if}
	{#if children}
		<span class="ui-button-content">
			{@render children()}
		</span>
	{/if}
	{#if shortcut && shortcutVisibility !== "none"}
		{#if shortcutVisibility === "hover"}
			<Kbd value={shortcut} class="ui-button-shortcut hover-shortcut" />
		{:else}
			<Kbd value={shortcut} class="ui-button-shortcut" />
		{/if}
	{/if}
</button>

<style>
	.ui-button {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.34rem;
		border-radius: var(--ui-radius-md);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		background: color-mix(in oklab, var(--ui-surface-raised) 82%, transparent);
		color: var(--ui-text-primary);
		font-weight: 600;
		letter-spacing: 0;
		line-height: 1;
		cursor: pointer;
		box-shadow: none;
		transition:
			border-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			box-shadow 170ms cubic-bezier(0.19, 1, 0.22, 1),
			transform 120ms cubic-bezier(0.22, 1, 0.36, 1);
		will-change: transform;
	}

	.ui-button-content {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: inherit;
		min-width: 0;
	}

	.ui-button::before {
		content: "";
		position: absolute;
		inset: 50% auto auto 50%;
		width: max(100%, 1.75rem);
		height: max(100%, 1.75rem);
		transform: translate(-50%, -50%);
		border-radius: inherit;
	}

	.ui-button:focus-visible {
		outline: none;
		box-shadow: var(--ui-focus-ring);
	}

	.ui-button:active:not(:disabled):not(.is-loading) {
		transform: translateY(1px) scale(0.985);
	}

	.ui-button:disabled {
		opacity: 0.5;
		cursor: default;
		box-shadow: none;
		transform: none;
	}

	.size-sm {
		min-height: 1.55rem;
		padding: 0.14rem 0.5rem;
		font-size: var(--text-xs);
	}

	.size-xs {
		min-height: 1.35rem;
		padding: 0.1rem 0.38rem;
		font-size: var(--text-xs);
	}

	.size-md {
		min-height: 1.9rem;
		padding: 0.24rem 0.68rem;
		font-size: var(--text-sm);
	}

	.icon-only {
		aspect-ratio: 1;
		width: 2.15rem;
		padding: 0;
	}

	.icon-only.size-xs {
		width: 1.65rem;
	}

	.icon-only.size-sm {
		width: 1.95rem;
	}

	.is-loading {
		pointer-events: none;
	}

	.ui-button :global(.ui-button-shortcut) {
		flex: 0 0 auto;
		color: currentColor;
	}

	.ui-button :global(.hover-shortcut) {
		position: absolute;
		inset: 50% auto auto 50%;
		max-width: calc(100% - 0.3rem);
		opacity: 0;
		transform: translate(-50%, -50%) scale(0.96);
		transition:
			opacity 110ms cubic-bezier(0.19, 1, 0.22, 1),
			transform 110ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.has-hover-shortcut .ui-button-content {
		transition:
			opacity 110ms cubic-bezier(0.19, 1, 0.22, 1),
			transform 110ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.has-hover-shortcut:hover:not(:disabled) .ui-button-content,
	.has-hover-shortcut:focus-visible .ui-button-content {
		opacity: 0;
		transform: scale(0.92);
	}

	.has-hover-shortcut:hover:not(:disabled) :global(.hover-shortcut),
	.has-hover-shortcut:focus-visible :global(.hover-shortcut) {
		opacity: 1;
		transform: translate(-50%, -50%) scale(1);
	}

	.ui-button-spinner {
		width: 0.72rem;
		height: 0.72rem;
		border-radius: 999px;
		border: 1.5px solid currentColor;
		border-right-color: transparent;
		animation: ui-button-spin 700ms linear infinite;
	}

	@keyframes ui-button-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.variant-primary {
		border-color: var(--ui-accent);
		background: var(--ui-accent);
		color: var(--ui-accent-ink);
		box-shadow: none;
	}

	.variant-primary:hover:not(:disabled) {
		border-color: var(--ui-accent-strong);
		background: var(--ui-accent-strong);
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

	@media (prefers-reduced-motion: reduce) {
		.ui-button {
			transition:
				border-color 0.01ms linear,
				background-color 0.01ms linear,
				color 0.01ms linear,
				box-shadow 0.01ms linear;
			will-change: auto;
		}

		.ui-button:active:not(:disabled):not(.is-loading) {
			transform: none;
		}

		.ui-button-spinner {
			animation-duration: 1.4s;
		}
	}

	@media (max-width: 760px) {
		.size-xs,
		.size-sm,
		.size-md {
			min-height: 2.75rem;
		}

		.icon-only.size-xs,
		.icon-only.size-sm,
		.icon-only.size-md {
			width: 2.75rem;
		}
	}
</style>
