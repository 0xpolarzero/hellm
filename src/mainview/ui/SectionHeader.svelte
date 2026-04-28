<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	type Props = HTMLAttributes<HTMLElement> & {
		eyebrow?: string;
		title: string;
		description?: string;
		actions?: Snippet;
	};

	let { eyebrow, title, description, actions, class: className = "", ...rest }: Props = $props();
</script>

<header {...rest} class={`ui-section-header ${className}`.trim()}>
	<div class="ui-section-header-copy">
		{#if eyebrow}
			<p class="ui-section-eyebrow">{eyebrow}</p>
		{/if}
		<h2>{title}</h2>
		{#if description}
			<p class="ui-section-description">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="ui-section-actions">
			{@render actions()}
		</div>
	{/if}
</header>

<style>
	.ui-section-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		min-width: 0;
	}

	.ui-section-header-copy {
		min-width: 0;
	}

	.ui-section-eyebrow,
	.ui-section-description,
	.ui-section-header h2 {
		margin: 0;
	}

	.ui-section-eyebrow {
		margin-bottom: 0.15rem;
		color: var(--ui-text-tertiary);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		text-transform: uppercase;
	}

	.ui-section-header h2 {
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--ui-text-primary);
		font-size: 0.82rem;
		font-weight: 660;
		line-height: 1.25;
	}

	.ui-section-description {
		margin-top: 0.18rem;
		color: var(--ui-text-secondary);
		font-size: 0.72rem;
		line-height: 1.35;
	}

	.ui-section-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.34rem;
		flex-shrink: 0;
	}
</style>
