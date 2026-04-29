<script lang="ts">
	import AlertCircleIcon from "@lucide/svelte/icons/alert-circle";
	import CircleDashedIcon from "@lucide/svelte/icons/circle-dashed";
	import InfoIcon from "@lucide/svelte/icons/info";
	import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	type StateTone = "empty" | "error" | "loading" | "info";

	type Props = HTMLAttributes<HTMLDivElement> & {
		tone?: StateTone;
		title?: string;
		description?: string;
		actions?: Snippet;
		children?: Snippet;
	};

	let {
		tone = "empty",
		title,
		description,
		actions,
		children,
		class: className = "",
		...rest
	}: Props = $props();
</script>

<div {...rest} class={`ui-state-message tone-${tone} ${className}`.trim()}>
	<span class="ui-state-icon" aria-hidden="true">
		{#if tone === "error"}
			<AlertCircleIcon size={16} strokeWidth={1.9} />
		{:else if tone === "loading"}
			<LoaderCircleIcon size={16} strokeWidth={1.9} class="spin" />
		{:else if tone === "info"}
			<InfoIcon size={16} strokeWidth={1.9} />
		{:else}
			<CircleDashedIcon size={16} strokeWidth={1.9} />
		{/if}
	</span>
	<div class="ui-state-copy">
		{#if title}
			<strong>{title}</strong>
		{/if}
		{#if description}
			<p>{description}</p>
		{/if}
		{#if children}
			<div class="ui-state-extra">
				{@render children()}
			</div>
		{/if}
	</div>
	{#if actions}
		<div class="ui-state-actions">
			{@render actions()}
		</div>
	{/if}
</div>

<style>
	.ui-state-message {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: start;
		gap: 0.62rem;
		padding: 0.72rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
		border-radius: var(--ui-radius-md);
		background: color-mix(in oklab, var(--ui-surface-subtle) 78%, transparent);
		color: var(--ui-text-secondary);
	}

	.ui-state-icon {
		display: inline-grid;
		place-items: center;
		width: 1.45rem;
		height: 1.45rem;
		border-radius: var(--ui-radius-md);
		background: color-mix(in oklab, var(--ui-surface-muted) 84%, transparent);
		color: var(--ui-text-tertiary);
	}

	.ui-state-copy {
		min-width: 0;
	}

	.ui-state-copy strong,
	.ui-state-copy p {
		margin: 0;
	}

	.ui-state-copy strong {
		display: block;
		color: var(--ui-text-primary);
		font-size: 0.78rem;
		font-weight: 650;
		line-height: 1.25;
	}

	.ui-state-copy p,
	.ui-state-extra {
		margin-top: 0.18rem;
		font-size: 0.72rem;
		line-height: 1.42;
	}

	.ui-state-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.34rem;
	}

	.tone-error {
		border-color: color-mix(in oklab, var(--ui-danger) 26%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-danger-soft) 78%, transparent);
	}

	.tone-error .ui-state-icon {
		background: color-mix(in oklab, var(--ui-danger-soft) 84%, transparent);
		color: var(--ui-danger);
	}

	.tone-loading .ui-state-icon {
		color: var(--ui-accent);
	}

	.tone-info .ui-state-icon {
		background: color-mix(in oklab, var(--ui-info-soft) 84%, transparent);
		color: var(--ui-info);
	}

	.spin {
		animation: ui-state-spin 800ms linear infinite;
	}

	@keyframes ui-state-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 760px) {
		.ui-state-message {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.ui-state-actions {
			grid-column: 1 / -1;
		}
	}
</style>
