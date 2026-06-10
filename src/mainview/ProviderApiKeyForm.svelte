<script lang="ts">
	import { createForm } from "@tanstack/svelte-form";
	import Button from "./ui/Button.svelte";
	import Input from "./ui/Input.svelte";

	type Props = {
		placeholder?: string;
		onSave: (apiKey: string) => Promise<void>;
		onCancel: () => void;
	};

	let { placeholder = "Paste API key...", onSave, onCancel }: Props = $props();
	let submitError = $state("");

	const form = createForm(() => ({
		defaultValues: { apiKey: "" },
		validators: {
			onChange: ({ value }) => (value.apiKey.trim() ? undefined : "API key is required."),
		},
		onSubmit: async ({ value, formApi }) => {
			submitError = "";
			await onSave(value.apiKey.trim());
			formApi.reset();
		},
	}));

	const formState = form.useStore();
	const hasUnsavedChanges = $derived(formState.current.isDirty);

	function submit() {
		void form.handleSubmit().catch((error) => {
			submitError = error instanceof Error ? error.message : "Failed to save API key.";
		});
	}
</script>

<div class="key-input-row">
	<Input
		type="password"
		placeholder={placeholder}
		value={formState.current.values.apiKey}
		oninput={(event) => form.setFieldValue("apiKey", event.currentTarget.value)}
		onkeydown={(event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				submit();
			}
		}}
	/>
	<Button
		variant="primary"
		size="xs"
		onclick={submit}
		disabled={!formState.current.canSubmit || !hasUnsavedChanges || formState.current.isSubmitting}
	>
		{formState.current.isSubmitting ? "Saving" : "Save"}
	</Button>
	<Button
		variant="ghost"
		size="xs"
		onclick={() => {
			form.reset();
			onCancel();
		}}
		disabled={formState.current.isSubmitting}
	>
		Cancel
	</Button>
</div>
{#if formState.current.errors.length > 0 || submitError}
	<p class="save-msg tone-danger">{submitError || formState.current.errors.join(" ")}</p>
{/if}

<style>
	.key-input-row {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.32rem;
		flex-wrap: wrap;
	}

	.save-msg {
		margin: 0.24rem 0 0;
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--ui-text-secondary);
	}

	.save-msg.tone-danger {
		color: color-mix(in oklab, var(--ui-danger) 84%, var(--ui-text-primary));
	}
</style>
