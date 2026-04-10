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
		text-align: left;
		border: none;
		background:
			radial-gradient(circle at top left, color-mix(in oklab, var(--ui-accent) 10%, transparent), transparent 30%),
			transparent;
	}

	.ui-status-copy {
		max-width: 34rem;
		padding: clamp(1rem, 2vw, 1.3rem);
	}

	.ui-status-eyebrow {
		margin: 0 0 0.32rem;
		font-size: 0.66rem;
		font-weight: 620;
		letter-spacing: 0.04em;
		color: color-mix(in oklab, var(--ui-accent-strong) 86%, var(--ui-text-primary));
	}

	h2 {
		margin: 0;
		font-size: 1.32rem;
		font-weight: 680;
		letter-spacing: -0.035em;
		color: var(--ui-text-primary);
	}

	p {
		margin: 0.55rem 0 0;
		max-width: 31rem;
		font-size: 0.9rem;
		line-height: 1.6;
		color: var(--ui-text-secondary);
	}

	:global(.ui-status-card.tone-error) .ui-status-eyebrow,
	:global(.ui-status-card.tone-error) h2,
	:global(.ui-status-card.tone-error) p {
		color: color-mix(in oklab, var(--ui-danger) 84%, var(--ui-text-primary));
	}

	.ui-status-extra {
		margin-top: 1rem;
	}

	@media (max-width: 720px) {
		:global(.ui-status-card) {
			text-align: center;
		}
	}
</style>
