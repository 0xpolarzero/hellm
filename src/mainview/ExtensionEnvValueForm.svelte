<script lang="ts">
	import { createForm } from "@tanstack/svelte-form";
	import Button from "./ui/Button.svelte";
	import Input from "./ui/Input.svelte";

	type Props = {
		configured: boolean;
		secret: boolean;
		onSave: (value: string) => Promise<void>;
		onRemove?: () => Promise<void>;
	};

	let { configured, secret, onSave, onRemove }: Props = $props();
	let submitError = $state("");
	let removeError = $state("");
	let removing = $state(false);

	const form = createForm(() => ({
		defaultValues: { value: "" },
		validators: {
			onChange: ({ value }) => (value.value.trim() ? undefined : "Value is required."),
		},
		onSubmit: async ({ value, formApi }) => {
			submitError = "";
			removeError = "";
			await onSave(value.value);
			formApi.reset();
		},
	}));

	const formState = form.useStore();
	const hasUnsavedChanges = $derived(formState.current.isDirty);
	const pending = $derived(formState.current.isSubmitting || removing);

	function submit() {
		void form.handleSubmit().catch(() => {
			submitError = "Unable to save extension env value.";
		});
	}

	function reset() {
		submitError = "";
		removeError = "";
		form.reset();
	}

	async function remove() {
		if (!onRemove || pending) return;
		removing = true;
		submitError = "";
		removeError = "";
		try {
			await onRemove();
			form.reset();
		} catch {
			removeError = "Unable to remove extension env value.";
		} finally {
			removing = false;
		}
	}
</script>

<div class="extension-env-value-control">
	<Input
		type={secret ? "password" : "text"}
		placeholder={secret ? "Enter secret..." : "Enter value..."}
		autocomplete={secret ? "new-password" : "off"}
		spellcheck="false"
		mono
		value={formState.current.values.value}
		disabled={pending}
		oninput={(event) => form.setFieldValue("value", event.currentTarget.value)}
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
		disabled={!formState.current.canSubmit || !hasUnsavedChanges || pending}
	>
		{formState.current.isSubmitting ? "Saving" : "Save"}
	</Button>
	<Button variant="ghost" size="xs" onclick={reset} disabled={!hasUnsavedChanges || pending}>
		Reset
	</Button>
	{#if configured && onRemove}
		<Button variant="ghost" size="xs" onclick={remove} disabled={pending}>
			{removing ? "Removing" : "Remove"}
		</Button>
	{/if}
</div>
{#if formState.current.errors.length > 0 || submitError || removeError}
	<p class="env-value-message tone-danger">
		{submitError || removeError || formState.current.errors.join(" ")}
	</p>
{/if}

<style>
	.extension-env-value-control {
		display: grid;
		grid-template-columns: minmax(10rem, 1fr) auto auto auto;
		align-items: center;
		gap: 0.34rem;
		margin-top: 0.5rem;
	}

	.env-value-message {
		margin: 0.28rem 0 0;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ui-text-secondary);
	}

	.env-value-message.tone-danger {
		color: color-mix(in oklab, var(--ui-danger) 84%, var(--ui-text-primary));
	}

	@media (max-width: 720px) {
		.extension-env-value-control {
			grid-template-columns: minmax(0, 1fr) auto auto;
		}

		.extension-env-value-control :global(button:last-child:nth-child(4)) {
			grid-column: 1 / -1;
			justify-self: start;
		}
	}
</style>
