<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";

	type Props = HTMLAttributes<HTMLHRElement> & {
		orientation?: "horizontal" | "vertical";
	};

	let { orientation = "horizontal", class: className = "", ...rest }: Props = $props();
</script>

<hr {...rest} class={`ui-divider orientation-${orientation} ${className}`.trim()} />

<style>
	.ui-divider {
		flex-shrink: 0;
		border: 0;
		background: color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
	}

	.orientation-horizontal {
		width: 100%;
		height: 1px;
		margin: 0;
	}

	.orientation-vertical {
		width: 1px;
		align-self: stretch;
		min-height: 1rem;
		margin: 0;
	}
</style>
