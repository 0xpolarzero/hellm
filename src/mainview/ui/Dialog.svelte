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
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem;
		background: rgba(12, 18, 28, 0.42);
		backdrop-filter: blur(14px);
	}

	.ui-dialog-panel {
		width: min(92vw, 780px);
		max-height: 82vh;
		display: flex;
		flex-direction: column;
		border-radius: calc(var(--ui-radius-xl) + 0.15rem);
		border: 1px solid var(--ui-border-soft);
		background:
			radial-gradient(circle at top, rgba(226, 232, 240, 0.7), transparent 46%),
			rgba(255, 255, 255, 0.95);
		box-shadow: 0 34px 90px rgba(12, 18, 28, 0.22);
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
		gap: 1rem;
		padding: 1.2rem 1.35rem 1rem;
		border-bottom: 1px solid rgba(226, 232, 240, 0.92);
	}

	.ui-dialog-copy h2 {
		margin: 0;
		font-size: 1.12rem;
		font-weight: 680;
		color: var(--ui-text-primary);
	}

	.ui-dialog-eyebrow {
		margin: 0 0 0.24rem;
		font-size: 0.72rem;
		font-weight: 750;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ui-accent-strong);
	}

	.ui-dialog-description {
		margin: 0.38rem 0 0;
		max-width: 42rem;
		font-size: 0.85rem;
		line-height: 1.55;
		color: var(--ui-text-secondary);
	}

	.ui-dialog-close {
		padding-inline: 0.72rem;
		font-size: 1.25rem;
		line-height: 1;
	}

	.ui-dialog-body {
		flex: 1;
		min-height: 0;
		padding: 1.1rem 1.35rem 1.35rem;
		overflow: auto;
	}
</style>
