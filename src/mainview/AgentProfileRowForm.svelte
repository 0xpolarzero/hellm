<script lang="ts">
	import CheckIcon from "@lucide/svelte/icons/check";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
	import CopyPlusIcon from "@lucide/svelte/icons/copy-plus";
	import GripVerticalIcon from "@lucide/svelte/icons/grip-vertical";
	import LockIcon from "@lucide/svelte/icons/lock";
	import Trash2Icon from "@lucide/svelte/icons/trash-2";
	import { createForm } from "@tanstack/svelte-form";
	import type {
		AgentProfileSettings,
		ReasoningEffort,
	} from "../shared/agent-settings";
	import type { AgentModelChoice } from "../shared/workspace-contract";
	import Checkbox from "./ui/Checkbox.svelte";
	import CompactCombobox, { type CompactComboboxOption } from "./ui/CompactCombobox.svelte";
	import CompactSelect, { type CompactSelectOption } from "./ui/CompactSelect.svelte";
	import ExtensionUsageControl from "./ExtensionUsageControl.svelte";
	import type { ExtensionUsageControlItem } from "./agents-pane-extension-usage";
	import Input from "./ui/Input.svelte";
	import Tooltip from "./ui/Tooltip.svelte";
	import { dismissConfirmation } from "./ui/dismiss-confirmation";

	type ProfileFormValues = {
		modelValue: string;
		name: string;
		reasoningEffort: ReasoningEffort;
		updateFromComposer: boolean;
	};

	type Props = {
		category: "orchestrator" | "special";
		confirmingDelete: boolean;
		deleting: boolean;
		expanded: boolean;
		modelChoices: AgentModelChoice[];
		profile: AgentProfileSettings;
		saving: boolean;
		extensionUsageItems: ExtensionUsageControlItem[];
		onCancelDelete: () => void;
		onConfirmDelete: () => void;
		onDuplicate?: () => void;
		onPointerDown?: (event: PointerEvent) => void;
		onOpenExtension: (extensionId: string) => void;
		onRequestDelete: () => void;
		onSave: (profile: AgentProfileSettings) => Promise<AgentProfileSettings>;
		onSetExtensionUsage: (
			extensionId: string,
			state: ExtensionUsageControlItem["state"],
		) => Promise<AgentProfileSettings>;
		onSetExtensionDefault?: (
			extensionId: string,
			state: ExtensionUsageControlItem["state"],
		) => Promise<void>;
		onToggleExpanded: () => void;
	};

	let {
		category,
		confirmingDelete,
		deleting,
		expanded,
		modelChoices,
		profile,
		saving,
		extensionUsageItems,
		onCancelDelete,
		onConfirmDelete,
		onDuplicate,
		onPointerDown,
		onOpenExtension,
		onRequestDelete,
		onSave,
		onSetExtensionUsage,
		onSetExtensionDefault,
		onToggleExpanded,
	}: Props = $props();

	let submitError = $state("");

	function modelChoiceValue(choice: Pick<AgentModelChoice, "providerId" | "modelId">): string {
		return `${choice.providerId}:${choice.modelId}`;
	}

	function agentModelValue(agent: Pick<AgentProfileSettings, "provider" | "model">): string {
		return `${agent.provider}:${agent.model}`;
	}

	function valuesFor(input: AgentProfileSettings): ProfileFormValues {
		return {
			modelValue: agentModelValue(input),
			name: input.name,
			reasoningEffort: input.reasoningEffort,
			updateFromComposer: input.updateFromComposer,
		};
	}

	function selectedChoice(modelValue: string): AgentModelChoice | null {
		return modelChoices.find((choice) => modelChoiceValue(choice) === modelValue) ?? null;
	}

	function modelOptions(currentValue: string): CompactComboboxOption[] {
		const options = modelChoices
			.filter((choice) => choice.providerAuthenticated || modelChoiceValue(choice) === currentValue)
			.toSorted((left, right) => {
				const leftCurrent = modelChoiceValue(left) === currentValue;
				const rightCurrent = modelChoiceValue(right) === currentValue;
				if (leftCurrent && !rightCurrent) return -1;
				if (!leftCurrent && rightCurrent) return 1;
				const providerComparison = left.providerId.localeCompare(right.providerId);
				return providerComparison === 0
					? left.modelId.localeCompare(right.modelId)
					: providerComparison;
			})
			.map((choice) => ({
				value: modelChoiceValue(choice),
				label: choice.modelId,
				triggerLabel: choice.modelId,
				searchText: `${choice.modelId} ${choice.providerId}`,
				disabled: !choice.providerAuthenticated,
			}));
		if (!options.some((option) => option.value === currentValue)) {
			options.unshift({
				value: currentValue,
				label: profile.model,
				triggerLabel: profile.model,
				searchText: `${profile.model} ${profile.provider}`,
				disabled: true,
			});
		}
		return options;
	}

	function reasoningOptions(modelValue: string, currentReasoning: ReasoningEffort): CompactSelectOption[] {
		const selected = selectedChoice(modelValue);
		const levels = selected?.supportedReasoning.length
			? selected.supportedReasoning
			: [currentReasoning];
		return levels.map((level) => ({
			value: level,
			label: level,
		}));
	}

	function nextReasoningFor(modelValue: string, currentReasoning: ReasoningEffort): ReasoningEffort {
		const supported = selectedChoice(modelValue)?.supportedReasoning ?? [];
		if (supported.includes(currentReasoning)) return currentReasoning;
		return (supported.includes("medium") ? "medium" : (supported[0] ?? "off")) as ReasoningEffort;
	}

	const form = createForm(() => ({
		defaultValues: valuesFor(profile),
		validators: {
			onChange: ({ value }) => {
				if (!value.name.trim()) return "Profile name is required.";
				const currentModelValue = agentModelValue(profile);
				const choice = selectedChoice(value.modelValue);
				if (!choice && value.modelValue !== currentModelValue) {
					return "Choose a model from the available provider metadata.";
				}
				if (choice && !choice.providerAuthenticated && value.modelValue !== currentModelValue) {
					return "Choose an authenticated provider model.";
				}
				if (
					!reasoningOptions(value.modelValue, profile.reasoningEffort).some(
						(option) => option.value === value.reasoningEffort,
					)
				) {
					return "Choose a reasoning level supported by the selected model.";
				}
				return undefined;
			},
		},
		onSubmit: async ({ value, formApi }) => {
			submitError = "";
			const choice = selectedChoice(value.modelValue);
			const [provider, model] = value.modelValue.split(/:(.*)/s);
			const next: AgentProfileSettings = {
				...profile,
				name: value.name.trim(),
				provider: choice?.providerId ?? provider,
				model: choice?.modelId ?? model,
				reasoningEffort: value.reasoningEffort,
				systemPrompt: "",
				updateFromComposer: value.updateFromComposer,
			};
			const saved = await onSave(next);
			formApi.reset(valuesFor(saved));
		},
	}));

	const formState = form.useStore();
	const controlsDisabled = $derived(deleting);
	const submitDisabled = $derived(deleting || formState.current.isSubmitting || saving);
	const hasUnsavedChanges = $derived(formState.current.isDirty);
	const formErrors = $derived(formState.current.errors.filter(Boolean));

	function submit() {
		if (!formState.current.isDirty || formState.current.isSubmitting) return;
		void form.handleSubmit().catch((error) => {
			submitError = error instanceof Error ? error.message : "Unable to save agent profile.";
		});
	}

	function submitSoon() {
		queueMicrotask(submit);
	}

	function resetForm() {
		submitError = "";
		form.reset(valuesFor(profile));
	}

	async function saveExtensionUsage(extensionId: string, state: ExtensionUsageControlItem["state"]) {
		submitError = "";
		await onSetExtensionUsage(extensionId, state);
	}
</script>

<div class="agent-profile-main">
	{#if category === "orchestrator"}
		<button
			class="agent-drag-handle"
			type="button"
			aria-label={profile.locked ? `${profile.name} stays first` : `Reorder ${profile.name}`}
			disabled={profile.locked}
			onpointerdown={onPointerDown}
		>
			{#if profile.locked}
				<LockIcon size={12} aria-hidden="true" />
			{:else}
				<GripVerticalIcon size={13} aria-hidden="true" />
			{/if}
		</button>
	{:else}
		<span class="agent-drag-placeholder"><LockIcon size={12} aria-hidden="true" /></span>
	{/if}
	{#if profile.locked}
		<span class="agent-locked-name">{category === "orchestrator" ? "Default" : profile.name}</span>
	{:else}
		<Input
			value={formState.current.values.name}
			class="agent-name-input"
			aria-label={`${profile.name} name`}
			disabled={controlsDisabled}
			oninput={(event) => form.setFieldValue("name", event.currentTarget.value)}
			onblur={submit}
			onkeydown={(event) => {
				if (event.key === "Enter") event.currentTarget.blur();
				if (event.key === "Escape") resetForm();
			}}
		/>
	{/if}
	<div class="agent-middle-controls">
		<div class="agent-controls">
			<CompactCombobox
				value={formState.current.values.modelValue}
				options={modelOptions(formState.current.values.modelValue)}
				ariaLabel={`${profile.name} model`}
				placeholder="Model"
				triggerClass="model-pill agent-model-field"
				menuClass="model-menu"
				placement="below"
				disabled={controlsDisabled}
				onSelect={(value) => {
					form.setFieldValue("modelValue", value);
					form.setFieldValue(
						"reasoningEffort",
						nextReasoningFor(value, formState.current.values.reasoningEffort),
					);
					submitSoon();
				}}
			/>
			<CompactSelect
				value={formState.current.values.reasoningEffort}
				options={reasoningOptions(
					formState.current.values.modelValue,
					formState.current.values.reasoningEffort,
				)}
				ariaLabel={`${profile.name} reasoning`}
				triggerClass="model-pill agent-reasoning-field"
				menuClass="thinking-menu"
				textTransform="lowercase"
				placement="below"
				disabled={controlsDisabled}
				onSelect={(value) => {
					form.setFieldValue("reasoningEffort", value as ReasoningEffort);
					submitSoon();
				}}
			/>
			<ExtensionUsageControl
				ariaLabel={`${profile.name} extension usage`}
				actor={category === "special" ? "handler" : "orchestrator"}
				disabled={controlsDisabled}
				items={extensionUsageItems}
				onOpenExtension={onOpenExtension}
				onSetExtensionDefault={onSetExtensionDefault}
				onStateChange={saveExtensionUsage}
			/>
		</div>
		<Tooltip
			label=""
			details={[
				{ label: "Enabled: sessions using this profile save composer model/reasoning changes back to the profile." },
				{ label: "Disabled: composer changes stay in the current session; new sessions use the profile settings." },
			]}
		>
			<label class="composer-sync-field">
				<Checkbox
					size="sm"
					checked={formState.current.values.updateFromComposer}
					disabled={controlsDisabled}
					onchange={(event) => {
						form.setFieldValue(
							"updateFromComposer",
							(event.currentTarget as HTMLInputElement).checked,
						);
						submitSoon();
					}}
				/>
				<span>Follow composer</span>
			</label>
		</Tooltip>
		{#if hasUnsavedChanges}
			<div class="agent-form-actions">
				<button type="button" class="agent-text-button" disabled={submitDisabled} onclick={submit}>
					{formState.current.isSubmitting ? "Saving" : "Save"}
				</button>
				<button type="button" class="agent-text-button" disabled={controlsDisabled} onclick={resetForm}>
					Reset
				</button>
			</div>
		{/if}
		<div
			class="agent-row-actions"
			use:dismissConfirmation={{
				active: confirmingDelete,
				onDismiss: onCancelDelete,
			}}
		>
			{#if category === "orchestrator"}
				<Tooltip label="Duplicate profile">
					<button
						type="button"
						class="agent-icon-button"
						aria-label={`Duplicate ${profile.name}`}
						disabled={controlsDisabled}
						onclick={onDuplicate}
					>
						<CopyPlusIcon size={13} aria-hidden="true" />
					</button>
				</Tooltip>
			{:else}
				<span class="agent-action-spacer" aria-hidden="true"></span>
			{/if}
			{#if confirmingDelete}
				<Tooltip label="Confirm delete">
					<button
						type="button"
						class="agent-icon-button danger"
						aria-label={`Confirm deleting ${profile.name}`}
						disabled={controlsDisabled}
						onclick={onConfirmDelete}
					>
						<CheckIcon size={13} aria-hidden="true" />
					</button>
				</Tooltip>
			{:else}
				<Tooltip label={profile.locked ? "Locked profile cannot be deleted" : "Delete profile"}>
					<button
						type="button"
						class="agent-icon-button danger"
						aria-label={`Delete ${profile.name}`}
						disabled={profile.locked || controlsDisabled}
						onclick={onRequestDelete}
					>
						<Trash2Icon size={13} aria-hidden="true" />
					</button>
				</Tooltip>
			{/if}
		</div>
	</div>
	<button
		type="button"
		class="agent-expand-button"
		aria-expanded={expanded}
		aria-label={expanded ? `Collapse ${profile.name}` : `Expand ${profile.name}`}
		onclick={onToggleExpanded}
	>
		{#if expanded}
			<ChevronDownIcon size={14} strokeWidth={1.9} aria-hidden="true" />
		{:else}
			<ChevronRightIcon size={14} strokeWidth={1.9} aria-hidden="true" />
		{/if}
	</button>
</div>
{#if formErrors.length > 0 || submitError}
	<p class="agent-form-error">{submitError || formErrors.join(" ")}</p>
{/if}

<style>
	.agent-profile-main {
		--agent-row-line-height: 1.45rem;

		display: flex;
		align-items: flex-start;
		gap: 0.36rem;
		min-width: 0;
	}

	.agent-drag-handle,
	.agent-drag-placeholder,
	.agent-expand-button {
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		width: 1.24rem;
		height: var(--agent-row-line-height);
		border: 0;
		border-radius: var(--ui-radius-sm);
		background: transparent;
		color: var(--ui-text-tertiary);
	}

	.agent-drag-handle {
		cursor: grab;
		touch-action: none;
	}

	.agent-drag-handle:disabled,
	.agent-drag-placeholder {
		cursor: default;
		opacity: 0.72;
	}

	.agent-expand-button {
		cursor: pointer;
	}

	.agent-drag-handle:not(:disabled):hover,
	.agent-drag-handle:not(:disabled):focus-visible,
	.agent-expand-button:hover,
	.agent-expand-button:focus-visible {
		outline: none;
		background: var(--ui-hover-bg);
		color: var(--ui-text-primary);
	}

	.agent-drag-handle:not(:disabled):focus-visible,
	.agent-expand-button:focus-visible,
	.agent-icon-button:focus-visible:not(:disabled) {
		box-shadow: var(--ui-focus-ring);
	}

	.agent-locked-name {
		display: flex;
		align-items: center;
		flex: 1 1 4.5rem;
		box-sizing: border-box;
		min-width: 0;
		height: var(--agent-row-line-height);
		min-height: 0;
		overflow: hidden;
		padding: 0 0.34rem;
		color: var(--ui-text-primary);
		font-size: var(--text-sm);
		font-weight: 600;
		line-height: 1.25;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.agent-name-input.ui-input) {
		box-sizing: border-box;
		flex: 1 1 4.5rem;
		min-width: 4.5rem;
		height: var(--agent-row-line-height);
		min-height: 0;
		padding: 0 0.34rem;
		border-color: transparent;
		background: transparent;
		font-weight: 600;
	}

	:global(.agent-name-input.ui-input:hover),
	:global(.agent-name-input.ui-input:focus-visible) {
		border-color: var(--ui-border-soft);
		background: var(--ui-bg-elevated);
	}

	.agent-middle-controls {
		display: flex;
		align-items: center;
		align-content: flex-start;
		justify-content: flex-end;
		gap: 0.36rem;
		flex: 0 1 auto;
		flex-wrap: wrap;
		min-width: 0;
		min-height: var(--agent-row-line-height);
		row-gap: 0.18rem;
	}

	.agent-controls {
		display: inline-flex;
		align-items: center;
		align-content: flex-start;
		gap: 0.36rem;
		flex: 0 1 auto;
		flex-wrap: wrap;
		min-width: 0;
		row-gap: 0.18rem;
	}

	.agent-controls :global(.compact-combobox),
	.agent-controls :global(.compact-select) {
		flex: 0 1 auto;
		min-width: 0;
	}

	:global(.compact-combobox-trigger.agent-model-field) {
		width: fit-content;
		max-width: clamp(6.6rem, 13vw, 8.8rem);
	}

	:global(.compact-select-trigger.agent-reasoning-field) {
		width: fit-content;
		max-width: clamp(4.9rem, 9vw, 5.8rem);
	}

	.composer-sync-field {
		display: inline-flex;
		align-items: center;
		gap: 0.28rem;
		flex: 0 0 auto;
		min-height: var(--agent-row-line-height);
		color: var(--ui-text-tertiary);
		font-size: var(--text-xs);
		line-height: 1;
		white-space: nowrap;
	}

	.agent-form-actions,
	.agent-row-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.08rem;
		flex: 0 0 auto;
		min-height: var(--agent-row-line-height);
	}

	.agent-text-button {
		min-height: 1.24rem;
		padding: 0 0.36rem;
		border: 0;
		border-radius: var(--ui-radius-sm);
		background: var(--ui-hover-bg);
		color: var(--ui-text-secondary);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.agent-text-button:hover:not(:disabled),
	.agent-text-button:focus-visible:not(:disabled) {
		outline: none;
		color: var(--ui-text-primary);
		box-shadow: var(--ui-focus-ring);
	}

	.agent-icon-button {
		display: grid;
		place-items: center;
		width: 1.32rem;
		height: var(--agent-row-line-height);
		border: 0;
		border-radius: var(--ui-radius-sm);
		background: transparent;
		color: var(--ui-text-tertiary);
		cursor: pointer;
	}

	.agent-icon-button:hover:not(:disabled),
	.agent-icon-button:focus-visible:not(:disabled) {
		outline: none;
		background: var(--ui-hover-bg);
		color: var(--ui-text-primary);
	}

	.agent-icon-button.danger:hover:not(:disabled),
	.agent-icon-button.danger:focus-visible:not(:disabled) {
		background: var(--ui-danger-soft);
		color: var(--ui-danger);
	}

	.agent-icon-button:disabled,
	.agent-text-button:disabled {
		cursor: default;
		opacity: 0.36;
	}

	.agent-action-spacer {
		width: 1.32rem;
		height: 1.32rem;
	}

	.agent-form-error {
		margin: 0 0 0 1.6rem;
		color: color-mix(in oklab, var(--ui-danger) 86%, var(--ui-text-primary));
		font-size: var(--text-xs);
	}
</style>
