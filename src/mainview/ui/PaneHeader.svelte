<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	type Props = HTMLAttributes<HTMLElement> & {
		eyebrow?: string;
		title: string;
		meta?: Snippet;
		actions?: Snippet;
	};

	let { eyebrow, title, meta, actions, class: className = "", ...rest }: Props = $props();
</script>

<header {...rest} class={`ui-pane-header ${className}`.trim()}>
	<div class="ui-pane-header-copy">
		{#if eyebrow}
			<p>{eyebrow}</p>
		{/if}
		<h1>{title}</h1>
	</div>
	{#if meta || actions}
		<div class="ui-pane-header-tray">
			{#if meta}
				<div class="ui-pane-header-meta">
					{@render meta()}
				</div>
			{/if}
			{#if actions}
				<div class="ui-pane-header-actions">
					{@render actions()}
				</div>
			{/if}
		</div>
	{/if}
</header>

<style>
	.ui-pane-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.875rem;
		min-height: 3rem;
		min-width: 0;
		padding: 0.52rem 0.72rem;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		background: color-mix(in oklab, var(--ui-surface) 92%, transparent);
	}

	.ui-pane-header-copy {
		min-width: 0;
	}

	.ui-pane-header p,
	.ui-pane-header h1 {
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ui-pane-header p {
		margin-bottom: 0.1rem;
		color: var(--ui-text-tertiary);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		text-transform: uppercase;
	}

	.ui-pane-header h1 {
		color: var(--ui-text-primary);
		font-size: 0.95rem;
		font-weight: 660;
		line-height: 1.2;
	}

	.ui-pane-header-tray,
	.ui-pane-header-meta,
	.ui-pane-header-actions {
		display: inline-flex;
		align-items: center;
		min-width: 0;
	}

	.ui-pane-header-tray {
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.ui-pane-header-meta,
	.ui-pane-header-actions {
		gap: 0.34rem;
	}

	@media (max-width: 760px) {
		.ui-pane-header {
			align-items: flex-start;
			flex-direction: column;
			gap: 0.5rem;
		}

		.ui-pane-header-tray {
			width: 100%;
			justify-content: space-between;
		}
	}
</style>
