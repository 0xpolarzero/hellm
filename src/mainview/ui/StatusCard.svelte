<script lang="ts">
	import type { Snippet } from "svelte";
	import Surface from "./Surface.svelte";

	type StatusTone = "default" | "error";

	type Props = {
		title: string;
		message: string;
		eyebrow?: string;
		tone?: StatusTone;
		children?: Snippet;
	};

	let { title, message, eyebrow, tone = "default", children }: Props = $props();
</script>

<Surface tone={tone === "error" ? "danger" : "subtle"} class={`ui-status-card tone-${tone}`}>
	<div class="ui-status-copy">
		{#if eyebrow}
			<p class="ui-status-eyebrow">{eyebrow}</p>
		{/if}
		<h2>{title}</h2>
		<p>{message}</p>
		{#if children}
			<div class="ui-status-extra">
				{@render children()}
			</div>
		{/if}
	</div>
</Surface>

<style>
	:global(.ui-status-card) {
		display: grid;
		place-items: center;
		height: 100%;
		min-height: 13rem;
		text-align: left;
		border: 1px solid var(--ui-border-soft);
		background: color-mix(in oklab, var(--ui-surface-subtle) 72%, transparent);
	}

	.ui-status-copy {
		max-width: 30rem;
		padding: 1rem;
	}

	.ui-status-eyebrow {
		margin: 0 0 0.24rem;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		font-weight: 620;
		letter-spacing: 0;
		color: color-mix(in oklab, var(--ui-accent-strong) 86%, var(--ui-text-primary));
	}

	h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 680;
		letter-spacing: 0;
		color: var(--ui-text-primary);
	}

	p {
		margin: 0.42rem 0 0;
		max-width: 28rem;
		font-size: 0.78rem;
		line-height: 1.48;
		color: var(--ui-text-secondary);
	}

	:global(.ui-status-card.tone-error) .ui-status-eyebrow,
	:global(.ui-status-card.tone-error) h2,
	:global(.ui-status-card.tone-error) p {
		color: color-mix(in oklab, var(--ui-danger) 84%, var(--ui-text-primary));
	}

	.ui-status-extra {
		margin-top: 0.72rem;
	}

	@media (max-width: 720px) {
		:global(.ui-status-card) {
			text-align: center;
		}
	}
</style>
