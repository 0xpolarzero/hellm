<script lang="ts">
	import XIcon from "@lucide/svelte/icons/x";
	import { onMount } from "svelte";
	import type { Snippet } from "svelte";
	import Button from "./Button.svelte";

	type DialogWidth = "md" | "lg";

	type Props = {
		title: string;
		eyebrow?: string;
		description?: string;
		width?: DialogWidth;
		class?: string;
		onClose?: () => void;
		children?: Snippet;
	};

	let {
		title,
		eyebrow,
		description,
		width = "lg",
		class: className = "",
		onClose,
		children,
	}: Props = $props();

	const dialogId = `ui-dialog-${Math.random().toString(36).slice(2)}`;
	const titleId = `${dialogId}-title`;
	const descriptionId = `${dialogId}-description`;
	let panelElement = $state<HTMLElement | null>(null);
	let previouslyFocusedElement: HTMLElement | null = null;

	function close() {
		onClose?.();
	}

	function handlePanelKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.stopPropagation();
			close();
			return;
		}

		if (event.key !== "Tab" || !panelElement) {
			return;
		}

		const focusable = Array.from(
			panelElement.querySelectorAll<HTMLElement>(
				'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
			),
		).filter((element) => !element.hasAttribute("disabled") && element.offsetParent !== null);

		if (focusable.length === 0) {
			event.preventDefault();
			panelElement.focus();
			return;
		}

		const first = focusable[0];
		const last = focusable[focusable.length - 1];

		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	onMount(() => {
		previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		requestAnimationFrame(() => {
			const firstFocusable = panelElement?.querySelector<HTMLElement>(
				'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
			);
			(firstFocusable ?? panelElement)?.focus();
		});

		return () => {
			previouslyFocusedElement?.focus();
		};
	});
</script>

<div class="ui-dialog-overlay">
	<button class="ui-dialog-backdrop" type="button" tabindex="-1" aria-label="Close dialog" onclick={close}></button>
	<div
		bind:this={panelElement}
		class={`ui-dialog-panel width-${width} ${className}`.trim()}
		role="dialog"
		aria-modal="true"
		aria-labelledby={titleId}
		aria-describedby={description ? descriptionId : undefined}
		tabindex="0"
		onclick={(event) => event.stopPropagation()}
		onkeydown={handlePanelKeydown}
	>
		<header class="ui-dialog-header">
			<div class="ui-dialog-copy">
				{#if eyebrow}
					<p class="ui-dialog-eyebrow">{eyebrow}</p>
				{/if}
				<h2 id={titleId}>{title}</h2>
				{#if description}
					<p id={descriptionId} class="ui-dialog-description">{description}</p>
				{/if}
			</div>
			<Button variant="ghost" size="sm" class="ui-dialog-close" onclick={close} aria-label="Close dialog">
				<XIcon aria-hidden="true" size={16} strokeWidth={1.9} />
			</Button>
		</header>

		<div class="ui-dialog-body">
			{#if children}
				{@render children()}
			{/if}
		</div>
	</div>
</div>

<style>
	.ui-dialog-overlay {
		position: fixed;
		inset: 0;
		z-index: var(--ui-z-dialog);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: clamp(0.75rem, 2vw, 1.5rem);
		background: color-mix(in oklab, var(--ui-bg) 24%, hsl(220 18% 6% / 0.68));
	}

	.ui-dialog-backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		background: transparent;
		cursor: default;
	}

	.ui-dialog-panel {
		position: relative;
		width: min(94vw, 780px);
		max-height: min(88vh, 52rem);
		display: flex;
		flex-direction: column;
		border-radius: var(--ui-radius-lg);
		border: 1px solid var(--ui-border-strong);
		background: var(--ui-surface);
		box-shadow: var(--ui-shadow-strong);
		overflow: hidden;
	}

	.ui-dialog-panel::before {
		content: none;
	}

	.width-md {
		max-width: 560px;
	}

	.width-lg {
		max-width: 720px;
	}

	.ui-dialog-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.9rem;
		min-height: 3.05rem;
		padding: 0.72rem 0.82rem 0.64rem;
		border-bottom: 1px solid var(--ui-border-soft);
		background: color-mix(in oklab, var(--ui-panel) 88%, transparent);
	}

	.ui-dialog-copy h2 {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 660;
		letter-spacing: 0;
		color: var(--ui-text-primary);
	}

	.ui-dialog-eyebrow {
		margin: 0 0 0.18rem;
		font-family: var(--font-mono);
		font-size: 0.58rem;
		font-weight: 620;
		letter-spacing: 0;
		color: color-mix(in oklab, var(--ui-accent-strong) 86%, var(--ui-text-primary));
	}

	.ui-dialog-description {
		margin: 0.2rem 0 0;
		max-width: 40rem;
		font-size: 0.74rem;
		line-height: 1.42;
		color: var(--ui-text-secondary);
	}

	.ui-dialog-close {
		flex-shrink: 0;
		inline-size: 1.55rem;
		padding: 0;
		font-size: 0.82rem;
		line-height: 1;
	}

	.ui-dialog-body {
		flex: 1;
		min-height: 0;
		padding: 0.78rem 0.82rem 0.86rem;
		overflow: auto;
	}

	@media (max-width: 760px) {
		.ui-dialog-overlay {
			align-items: flex-end;
			padding: 0.75rem;
		}

		.ui-dialog-panel {
			width: 100%;
			max-height: 92vh;
			border-bottom-right-radius: calc(var(--ui-radius-lg) + 0.08rem);
			border-bottom-left-radius: calc(var(--ui-radius-lg) + 0.08rem);
		}

		.ui-dialog-header,
		.ui-dialog-body {
			padding-inline: 1rem;
		}

		.ui-dialog-close {
			inline-size: 2.75rem;
		}
	}
</style>
