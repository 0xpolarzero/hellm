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
			linear-gradient(180deg, color-mix(in oklab, black 12%, transparent), color-mix(in oklab, black 34%, transparent));
		backdrop-filter: blur(10px);
	}

	.ui-dialog-panel {
		position: relative;
		width: min(94vw, 780px);
		max-height: min(88vh, 58rem);
		display: flex;
		flex-direction: column;
		border-radius: var(--ui-radius-lg);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-surface-raised) 82%, transparent), transparent),
			var(--ui-surface);
		box-shadow: var(--ui-shadow-strong);
		overflow: hidden;
	}

	.ui-dialog-panel::before {
		content: none;
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
		padding: 1rem 1.05rem 0.82rem;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		background: color-mix(in oklab, var(--ui-surface-subtle) 86%, transparent);
	}

	.ui-dialog-copy h2 {
		margin: 0;
		font-size: 1.02rem;
		font-weight: 660;
		letter-spacing: -0.03em;
		color: var(--ui-text-primary);
	}

	.ui-dialog-eyebrow {
		margin: 0 0 0.24rem;
		font-size: 0.62rem;
		font-weight: 620;
		letter-spacing: 0.02em;
		color: color-mix(in oklab, var(--ui-accent-strong) 86%, var(--ui-text-primary));
	}

	.ui-dialog-description {
		margin: 0.28rem 0 0;
		max-width: 44rem;
		font-size: 0.81rem;
		line-height: 1.5;
		color: var(--ui-text-secondary);
	}

	.ui-dialog-close {
		flex-shrink: 0;
		inline-size: 1.75rem;
		padding: 0;
		font-size: 0.94rem;
		line-height: 1;
	}

	.ui-dialog-body {
		flex: 1;
		min-height: 0;
		padding: 0.92rem 1.05rem 1.05rem;
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
	}
</style>
