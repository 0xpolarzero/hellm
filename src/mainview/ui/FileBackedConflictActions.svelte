<script lang="ts">
	import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
	import SaveIcon from "@lucide/svelte/icons/save";
	import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
	import XIcon from "@lucide/svelte/icons/x";
	import Tooltip from "./Tooltip.svelte";
	import { dismissConfirmation } from "./dismiss-confirmation";

	type Props = {
		active: boolean;
		disabled?: boolean;
		label?: string;
		onDiscard: () => void;
		onDismiss: () => void;
		onKeepEditing: () => void;
		onOpen: () => void;
		onOverwrite: () => void;
	};

	let {
		active,
		disabled = false,
		label = "File changed outside svvy",
		onDiscard,
		onDismiss,
		onKeepEditing,
		onOpen,
		onOverwrite,
	}: Props = $props();
</script>

<span
	class="file-backed-conflict-actions"
	use:dismissConfirmation={{
		active,
		onDismiss,
	}}
>
	{#if active}
		<span class="file-backed-conflict-popover" role="dialog" aria-label={label}>
			<Tooltip label="Keep editing local draft">
				<button
					type="button"
					class="file-backed-conflict-button"
					aria-label="Keep editing local draft"
					{disabled}
					onclick={onKeepEditing}
				>
					<XIcon size={13} aria-hidden="true" />
				</button>
			</Tooltip>
			<Tooltip label="Discard local changes">
				<button
					type="button"
					class="file-backed-conflict-button danger"
					aria-label="Discard local changes"
					{disabled}
					onclick={onDiscard}
				>
					<RotateCcwIcon size={13} aria-hidden="true" />
				</button>
			</Tooltip>
			<Tooltip label="Overwrite external changes">
				<button
					type="button"
					class="file-backed-conflict-button danger"
					aria-label="Overwrite external changes"
					{disabled}
					onclick={onOverwrite}
				>
					<SaveIcon size={13} aria-hidden="true" />
				</button>
			</Tooltip>
		</span>
	{:else}
		<Tooltip label={label}>
			<button
				type="button"
				class="file-backed-conflict-warning"
				aria-label={label}
				{disabled}
				onclick={onOpen}
			>
				<TriangleAlertIcon size={13} strokeWidth={2} aria-hidden="true" />
			</button>
		</Tooltip>
	{/if}
</span>

<style>
	.file-backed-conflict-actions {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.file-backed-conflict-warning {
		display: grid;
		place-items: center;
		width: 1.28rem;
		height: 1.28rem;
		border: 0;
		border-radius: var(--ui-radius-sm);
		background: transparent;
		color: color-mix(in oklab, var(--ui-warning) 84%, var(--ui-text-secondary));
		cursor: pointer;
	}

	.file-backed-conflict-warning:hover:not(:disabled),
	.file-backed-conflict-warning:focus-visible:not(:disabled) {
		outline: none;
		background: var(--ui-warning-soft);
	}

	.file-backed-conflict-warning:focus-visible:not(:disabled) {
		box-shadow: var(--ui-focus-ring);
	}

	.file-backed-conflict-warning:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.file-backed-conflict-popover {
		display: inline-flex;
		align-items: center;
		gap: 0.18rem;
		min-height: 1.28rem;
	}

	.file-backed-conflict-button {
		display: grid;
		place-items: center;
		width: 1.32rem;
		height: 1.28rem;
		border: 0;
		border-radius: var(--ui-radius-sm);
		background: transparent;
		color: var(--ui-text-tertiary);
		cursor: pointer;
	}

	.file-backed-conflict-button:hover:not(:disabled),
	.file-backed-conflict-button:focus-visible:not(:disabled) {
		outline: none;
		background: var(--ui-hover-bg);
		color: var(--ui-text-primary);
	}

	.file-backed-conflict-button:focus-visible:not(:disabled) {
		box-shadow: var(--ui-focus-ring);
	}

	.file-backed-conflict-button.danger:hover:not(:disabled),
	.file-backed-conflict-button.danger:focus-visible:not(:disabled) {
		background: var(--ui-danger-soft);
		color: var(--ui-danger);
	}

	.file-backed-conflict-button:disabled {
		cursor: default;
		opacity: 0.36;
	}
</style>
