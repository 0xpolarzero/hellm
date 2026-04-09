<script lang="ts">
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

	function close() {
		onClose?.();
	}

	function handleBackdropKeydown(event: KeyboardEvent) {
		if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			close();
		}
	}

	function handlePanelKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.stopPropagation();
			close();
		}
	}
</script>

<div
	class="ui-dialog-overlay"
	role="button"
	tabindex="0"
	aria-label="Close dialog"
	onclick={close}
	onkeydown={handleBackdropKeydown}
>
	<section
		class={`ui-dialog-panel width-${width} ${className}`.trim()}
		role="dialog"
		aria-modal="true"
		tabindex="0"
		onclick={(event) => event.stopPropagation()}
		onkeydown={handlePanelKeydown}
	>
		<header class="ui-dialog-header">
			<div class="ui-dialog-copy">
				{#if eyebrow}
					<p class="ui-dialog-eyebrow">{eyebrow}</p>
				{/if}
				<h2>{title}</h2>
				{#if description}
					<p class="ui-dialog-description">{description}</p>
				{/if}
			</div>
			<Button variant="ghost" size="sm" class="ui-dialog-close" onclick={close} aria-label="Close dialog">
				×
			</Button>
		</header>

		<div class="ui-dialog-body">
			{#if children}
				{@render children()}
			{/if}
		</div>
	</section>
</div>

<style>
	.ui-dialog-overlay {
		position: fixed;
		inset: 0;
		z-index: var(--ui-z-dialog);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: clamp(1rem, 3vw, 2rem);
		background:
			linear-gradient(180deg, color-mix(in oklab, black 40%, transparent), color-mix(in oklab, black 54%, transparent)),
			radial-gradient(circle at top, color-mix(in oklab, var(--ui-accent) 12%, transparent), transparent 38%);
		backdrop-filter: blur(6px);
	}

	.ui-dialog-panel {
		position: relative;
		width: min(94vw, 780px);
		max-height: min(88vh, 58rem);
		display: flex;
		flex-direction: column;
		border-radius: var(--ui-radius-xl);
		border: 1px solid var(--ui-border-soft);
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-bg-elevated) 94%, transparent), var(--ui-surface));
		box-shadow: var(--ui-shadow-strong);
		overflow: hidden;
	}

	.ui-dialog-panel::before {
		content: "";
		position: absolute;
		inset: 0 0 auto;
		height: 0.3rem;
		background: linear-gradient(90deg, var(--ui-accent-strong), color-mix(in oklab, var(--ui-accent) 72%, white 28%));
	}

	.width-md {
		max-width: 640px;
	}

	.width-lg {
		max-width: 780px;
	}

	.ui-dialog-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1.2rem;
		padding: 1.4rem 1.45rem 1rem;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-panel-accent) 58%, transparent), transparent 110%);
	}

	.ui-dialog-copy h2 {
		margin: 0;
		font-size: 1.28rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: var(--ui-text-primary);
	}

	.ui-dialog-eyebrow {
		margin: 0 0 0.24rem;
		font-size: 0.71rem;
		font-weight: 760;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: color-mix(in oklab, var(--ui-accent-strong) 86%, var(--ui-text-primary));
	}

	.ui-dialog-description {
		margin: 0.45rem 0 0;
		max-width: 44rem;
		font-size: 0.9rem;
		line-height: 1.6;
		color: var(--ui-text-secondary);
	}

	.ui-dialog-close {
		flex-shrink: 0;
		inline-size: 2.4rem;
		padding: 0;
		font-size: 1.2rem;
		line-height: 1;
	}

	.ui-dialog-body {
		flex: 1;
		min-height: 0;
		padding: 1.15rem 1.45rem 1.45rem;
		overflow: auto;
	}

	@media (max-width: 720px) {
		.ui-dialog-overlay {
			align-items: flex-end;
			padding: 0.75rem;
		}

		.ui-dialog-panel {
			width: 100%;
			max-height: 92vh;
			border-bottom-right-radius: 0.9rem;
			border-bottom-left-radius: 0.9rem;
		}

		.ui-dialog-header,
		.ui-dialog-body {
			padding-inline: 1rem;
		}
	}
</style>
