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
		min-height: 18rem;
		text-align: center;
	}

	.ui-status-copy {
		max-width: 34rem;
	}

	.ui-status-eyebrow {
		margin: 0 0 0.32rem;
		font-size: 0.74rem;
		font-weight: 780;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ui-accent-strong);
	}

	h2 {
		margin: 0;
		font-size: 1.16rem;
		font-weight: 720;
		letter-spacing: -0.03em;
		color: var(--ui-text-primary);
	}

	p {
		margin: 0.5rem 0 0;
		line-height: 1.6;
		color: var(--ui-text-secondary);
	}

	:global(.ui-status-card.tone-error) .ui-status-eyebrow,
	:global(.ui-status-card.tone-error) h2,
	:global(.ui-status-card.tone-error) p {
		color: #991b1b;
	}

	.ui-status-extra {
		margin-top: 1rem;
	}
</style>
