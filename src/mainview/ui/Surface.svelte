<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	type SurfaceTone = "default" | "subtle" | "muted" | "danger";
	type SurfacePadding = "none" | "sm" | "md" | "lg";

	type Props = HTMLAttributes<HTMLDivElement> & {
		tone?: SurfaceTone;
		padding?: SurfacePadding;
		children?: Snippet;
	};

	let {
		tone = "default",
		padding = "md",
		class: className = "",
		children,
		...rest
	}: Props = $props();
</script>

<div {...rest} class={`ui-surface tone-${tone} padding-${padding} ${className}`.trim()}>
	{#if children}
		{@render children()}
	{/if}
</div>

<style>
	.ui-surface {
		position: relative;
		border-radius: var(--ui-radius-md);
		border: 1px solid var(--ui-border-soft);
		background: var(--ui-surface);
		box-shadow: none;
		overflow: hidden;
	}

	.ui-surface::before {
		content: none;
	}

	.tone-subtle {
		background: color-mix(in oklab, var(--ui-surface-subtle) 92%, transparent);
	}

	.tone-muted {
		background: color-mix(in oklab, var(--ui-surface-muted) 88%, transparent);
	}

	.tone-danger {
		background: color-mix(in oklab, var(--ui-danger-soft) 72%, var(--ui-surface));
		border-color: color-mix(in oklab, var(--ui-danger) 22%, var(--ui-border-soft));
	}

	.padding-none {
		padding: 0;
	}

	.padding-sm {
		padding: 0.58rem;
	}

	.padding-md {
		padding: 0.72rem;
	}

	.padding-lg {
		padding: 0.95rem;
	}
</style>
