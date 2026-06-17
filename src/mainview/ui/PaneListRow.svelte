<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";

	type Props = HTMLButtonAttributes & {
		title: string;
		description?: string | null;
		active?: boolean;
		leading?: Snippet;
		meta?: Snippet;
		trailing?: Snippet;
		subtitle?: Snippet;
	};

	let {
		title,
		description = null,
		active = false,
		leading,
		meta,
		trailing,
		subtitle,
		type = "button",
		class: className = "",
		...rest
	}: Props = $props();
</script>

<button
	{...rest}
	{type}
	class={`ui-pane-list-row ${active ? "active" : ""} ${leading ? "" : "no-leading"} ${className}`.trim()}
>
	{#if leading}
		<span class="ui-pane-list-leading">
			{@render leading()}
		</span>
	{/if}
	<span class="ui-pane-list-copy">
		<span class="ui-pane-list-title-line">
			<strong>{title}</strong>
			{#if meta}
				<span class="ui-pane-list-meta">
					{@render meta()}
				</span>
			{/if}
		</span>
		{#if subtitle}
			<span class="ui-pane-list-subtitle">
				{@render subtitle()}
			</span>
		{:else if description}
			<span class="ui-pane-list-description">{description}</span>
		{/if}
	</span>
	{#if trailing}
		<span class="ui-pane-list-trailing">
			{@render trailing()}
		</span>
	{/if}
</button>

<style>
	.ui-pane-list-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.46rem;
		width: 100%;
		min-width: 0;
		padding: 0.48rem 0.52rem;
		border: 1px solid transparent;
		border-radius: var(--ui-radius-sm);
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
			box-shadow 150ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.ui-pane-list-row.no-leading {
		grid-template-columns: minmax(0, 1fr) auto;
	}

	.ui-pane-list-row:hover,
	.ui-pane-list-row:focus-visible,
	.ui-pane-list-row.active {
		outline: none;
		border-color: color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		background: color-mix(in oklab, var(--ui-surface-raised) 84%, transparent);
	}

	.ui-pane-list-row:focus-visible {
		box-shadow: var(--ui-focus-ring);
	}

	.ui-pane-list-row.active {
		box-shadow: inset 2px 0 0 var(--ui-accent);
	}

	.ui-pane-list-leading {
		display: grid;
		place-items: center;
		width: 1.35rem;
		height: 1.35rem;
		color: var(--ui-text-tertiary);
	}

	.ui-pane-list-copy {
		display: grid;
		gap: 0.22rem;
		min-width: 0;
	}

	.ui-pane-list-title-line,
	.ui-pane-list-subtitle,
	.ui-pane-list-description,
	.ui-pane-list-meta,
	.ui-pane-list-trailing {
		display: inline-flex;
		align-items: center;
		min-width: 0;
	}

	.ui-pane-list-title-line {
		gap: 0.36rem;
		justify-content: space-between;
	}

	strong {
		min-width: 0;
		overflow: hidden;
		color: var(--ui-text-primary);
		font-size: var(--text-sm);
		font-weight: 650;
		line-height: 1.25;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ui-pane-list-description,
	.ui-pane-list-subtitle {
		overflow: hidden;
		color: var(--ui-text-tertiary);
		font-size: var(--text-xs);
		line-height: 1.35;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ui-pane-list-subtitle {
		gap: 0.34rem;
	}

	.ui-pane-list-meta,
	.ui-pane-list-trailing {
		flex: 0 0 auto;
		gap: 0.22rem;
	}
</style>
