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
		border-radius: var(--ui-radius-lg);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
		background: var(--ui-surface);
		box-shadow: none;
		overflow: hidden;
	}

	.ui-surface::before {
		content: "";
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: linear-gradient(180deg, color-mix(in oklab, white 24%, transparent), transparent 30%);
		opacity: 0.28;
	}

	.tone-subtle {
		background: var(--ui-surface-subtle);
	}

	.tone-muted {
		background: var(--ui-surface-muted);
	}

	.tone-danger {
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-danger-soft) 90%, transparent), var(--ui-surface));
		border-color: color-mix(in oklab, var(--ui-danger) 22%, var(--ui-border-soft));
	}

	.padding-none {
		padding: 0;
	}

	.padding-sm {
		padding: 0.8rem;
	}

	.padding-md {
		padding: 1rem;
	}

	.padding-lg {
		padding: 1.3rem;
	}
</style>
