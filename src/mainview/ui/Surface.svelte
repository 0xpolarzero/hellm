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
		border-radius: var(--ui-radius-xl);
		border: 1px solid var(--ui-border-soft);
		background: var(--ui-surface);
		box-shadow: var(--ui-shadow-soft);
	}

	.tone-subtle {
		background: rgba(255, 255, 255, 0.76);
	}

	.tone-muted {
		background: rgba(248, 250, 252, 0.86);
	}

	.tone-danger {
		background:
			radial-gradient(circle at top, rgba(254, 226, 226, 0.82), transparent 46%),
			rgba(255, 255, 255, 0.92);
		border-color: rgba(248, 113, 113, 0.34);
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
