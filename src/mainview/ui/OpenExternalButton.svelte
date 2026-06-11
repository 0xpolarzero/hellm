<script lang="ts">
	import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import type { PreferredExternalEditor } from "../../shared/agent-settings";
	import Tooltip from "./Tooltip.svelte";
	import { openExternalEditorTooltip } from "./open-external-editor";

	type OpenExternalButtonSize = "xs" | "sm";
	type Props = Omit<HTMLButtonAttributes, "children"> & {
		editor?: PreferredExternalEditor | null;
		iconSize?: number;
		size?: OpenExternalButtonSize;
		targetLabel?: string | null;
		tooltipLabel?: string | null;
	};

	let {
		editor = "system",
		iconSize = 12,
		size = "xs",
		targetLabel = null,
		tooltipLabel = null,
		type = "button",
		class: className = "",
		...rest
	}: Props = $props();

	const label = $derived(tooltipLabel ?? openExternalEditorTooltip(editor));
	const ariaLabel = $derived(
		rest["aria-label"] ?? (targetLabel ? `${label}: ${targetLabel}` : label),
	);
</script>

<Tooltip {label}>
	<button
		{...rest}
		{type}
		aria-label={ariaLabel}
		class={`open-external-button size-${size} ${className}`.trim()}
	>
		<ExternalLinkIcon size={iconSize} aria-hidden="true" />
	</button>
</Tooltip>

<style>
	.open-external-button {
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		width: var(--open-external-button-size);
		height: var(--open-external-button-size);
		padding: 0;
		border: 0;
		border-radius: var(--ui-radius-sm);
		background: transparent;
		color: var(--ui-text-tertiary);
		cursor: pointer;
		transition:
			background-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			box-shadow 170ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.size-xs {
		--open-external-button-size: 1.24rem;
	}

	.size-sm {
		--open-external-button-size: 1.55rem;
	}

	.open-external-button :global(svg) {
		display: block;
	}

	.open-external-button:hover,
	.open-external-button:focus-visible {
		outline: none;
		background: var(--ui-hover-bg);
		color: var(--ui-text-primary);
	}

	.open-external-button:focus-visible {
		box-shadow: var(--ui-focus-ring);
	}

	.open-external-button:disabled {
		cursor: default;
		opacity: 0.36;
	}
</style>
