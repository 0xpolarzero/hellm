<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	type Props = HTMLAttributes<HTMLElement> & {
		eyebrow: string;
		title: string;
		subtitle?: string | null;
		actions?: Snippet;
		meta?: Snippet;
	};

	let {
		eyebrow,
		title,
		subtitle = null,
		actions,
		meta,
		class: className = "",
		...rest
	}: Props = $props();
</script>

<header {...rest} class={`ui-pane-header ${className}`.trim()}>
	<div class="ui-pane-header-copy">
		<p>{eyebrow}</p>
		<div class="ui-pane-header-title-row">
			<h2>{title}</h2>
			{#if meta}
				<div class="ui-pane-header-meta">
					{@render meta()}
				</div>
			{/if}
		</div>
		{#if subtitle}
			<span>{subtitle}</span>
		{/if}
	</div>
	{#if actions}
		<div class="ui-pane-header-actions">
			{@render actions()}
		</div>
	{/if}
</header>

<style>
	.ui-pane-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.72rem;
		min-width: 0;
		padding: 0.58rem 0.78rem;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
		background: color-mix(in oklab, var(--ui-surface-subtle) 82%, transparent);
	}

	.ui-pane-header-copy {
		display: grid;
		gap: 0.12rem;
		min-width: 0;
	}

	.ui-pane-header-title-row {
		display: inline-flex;
		align-items: center;
		gap: 0.42rem;
		min-width: 0;
	}

	p,
	h2,
	span {
		margin: 0;
		min-width: 0;
	}

	p {
		color: var(--ui-text-tertiary);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0;
		text-transform: uppercase;
	}

	h2 {
		overflow: hidden;
		color: var(--ui-text-primary);
		font-size: var(--text-base);
		font-weight: 650;
		line-height: 1.25;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	span {
		overflow: hidden;
		color: var(--ui-text-tertiary);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.35;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ui-pane-header-meta,
	.ui-pane-header-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}

	.ui-pane-header-actions {
		flex: 0 0 auto;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	@container (max-width: 38rem) {
		.ui-pane-header {
			align-items: flex-start;
			flex-direction: column;
		}

		.ui-pane-header-actions {
			justify-content: flex-start;
		}
	}
</style>
