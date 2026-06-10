<script lang="ts">
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
	import LockIcon from "@lucide/svelte/icons/lock";
	import { createForm } from "@tanstack/svelte-form";
	import type { ReasoningEffort, WorkflowAgentSettings } from "../shared/agent-settings";
	import type { AgentModelChoice } from "../shared/workspace-contract";
	import CompactCombobox, { type CompactComboboxOption } from "./ui/CompactCombobox.svelte";
	import CompactSelect, { type CompactSelectOption } from "./ui/CompactSelect.svelte";
	import Input from "./ui/Input.svelte";

	type WorkflowFormValues = {
		instructions: string;
		label: string;
		modelValue: string;
		reasoningEffort: ReasoningEffort;
	};

	type Props = {
		agent: WorkflowAgentSettings;
		expanded: boolean;
		modelChoices: AgentModelChoice[];
		saving: boolean;
		usageSummary: string;
		onSave: (agent: WorkflowAgentSettings) => Promise<WorkflowAgentSettings>;
		onToggleExpanded: () => void;
	};

	let { agent, expanded, modelChoices, saving, usageSummary, onSave, onToggleExpanded }: Props =
		$props();
	let submitError = $state("");

	function modelChoiceValue(choice: Pick<AgentModelChoice, "providerId" | "modelId">): string {
		return `${choice.providerId}:${choice.modelId}`;
	}

	function agentModelValue(input: Pick<WorkflowAgentSettings, "provider" | "model">): string {
		return `${input.provider}:${input.model}`;
	}

	function valuesFor(input: WorkflowAgentSettings): WorkflowFormValues {
		return {
			instructions: input.instructions,
			label: input.label,
			modelValue: agentModelValue(input),
			reasoningEffort: input.reasoningEffort,
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
				label: agent.model,
				triggerLabel: agent.model,
				searchText: `${agent.model} ${agent.provider}`,
				disabled: true,
			});
		}
		return options;
	}

	function reasoningOptions(
		modelValue: string,
		currentReasoning: ReasoningEffort,
	): CompactSelectOption[] {
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

	function providerModelFrom(value: string): Pick<WorkflowAgentSettings, "model" | "provider"> {
		const separator = value.indexOf(":");
		return separator >= 0
			? { provider: value.slice(0, separator), model: value.slice(separator + 1) }
			: { provider: agent.provider, model: agent.model };
	}

	const form = createForm(() => ({
		defaultValues: valuesFor(agent),
		validators: {
			onChange: ({ value }) => {
				if (!value.label.trim()) return "Workflow agent label is required.";
				if (!value.instructions.trim()) return "Workflow agent instructions are required.";
				const currentModelValue = agentModelValue(agent);
				const choice = selectedChoice(value.modelValue);
				if (!choice && value.modelValue !== currentModelValue) {
					return "Choose a model from the available provider metadata.";
				}
				if (choice && !choice.providerAuthenticated && value.modelValue !== currentModelValue) {
					return "Choose an authenticated provider model.";
				}
				if (
					!reasoningOptions(value.modelValue, agent.reasoningEffort).some(
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
			const fallback = providerModelFrom(value.modelValue);
			const next: WorkflowAgentSettings = {
				...agent,
				label: value.label.trim(),
				provider: choice?.providerId ?? fallback.provider,
				model: choice?.modelId ?? fallback.model,
				reasoningEffort: value.reasoningEffort,
				instructions: value.instructions.trim(),
				extensions: [...agent.extensions],
				extensionUsage: { ...agent.extensionUsage },
			};
			const saved = await onSave(next);
			formApi.reset(valuesFor(saved));
		},
	}));

	const formState = form.useStore();
	const disabled = $derived(saving || formState.current.isSubmitting);
	const hasUnsavedChanges = $derived(formState.current.isDirty);
	const formErrors = $derived(formState.current.errors.filter(Boolean));

	function submit() {
		if (!formState.current.isDirty) return;
		void form.handleSubmit().catch((error) => {
			submitError = error instanceof Error ? error.message : "Unable to save workflow agent.";
		});
	}

	function submitSoon() {
		queueMicrotask(submit);
	}

	function resetForm() {
		submitError = "";
		form.reset(valuesFor(agent));
	}
</script>

<div class="agent-profile-main">
	<span class="agent-drag-placeholder"><LockIcon size={12} aria-hidden="true" /></span>
	<Input
		value={formState.current.values.label}
		class="agent-name-input"
		aria-label={`${agent.label} label`}
		disabled={disabled}
		oninput={(event) => form.setFieldValue("label", event.currentTarget.value)}
		onblur={submit}
		onkeydown={(event) => {
			if (event.key === "Enter") event.currentTarget.blur();
			if (event.key === "Escape") resetForm();
		}}
	/>
	<div class="agent-middle-controls">
		<div class="agent-controls">
			<CompactCombobox
				value={formState.current.values.modelValue}
				options={modelOptions(formState.current.values.modelValue)}
				ariaLabel={`${agent.label} model`}
				placeholder="Model"
				triggerClass="model-pill agent-model-field"
				menuClass="model-menu"
				placement="below"
				disabled={disabled}
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
				ariaLabel={`${agent.label} reasoning`}
				triggerClass="model-pill agent-reasoning-field"
				menuClass="thinking-menu"
				textTransform="lowercase"
				placement="below"
				disabled={disabled}
				onSelect={(value) => {
					form.setFieldValue("reasoningEffort", value as ReasoningEffort);
					submitSoon();
				}}
			/>
			<span class="model-pill extensions-field extension-usage-summary">
				{usageSummary}
			</span>
		</div>
		{#if hasUnsavedChanges}
			<div class="agent-form-actions">
				<button type="button" class="agent-text-button" disabled={disabled} onclick={submit}>
					{formState.current.isSubmitting ? "Saving" : "Save"}
				</button>
				<button type="button" class="agent-text-button" disabled={disabled} onclick={resetForm}>
					Reset
				</button>
			</div>
		{/if}
	</div>
	<button
		type="button"
		class="agent-expand-button"
		aria-expanded={expanded}
		aria-label={expanded ? `Collapse ${agent.label}` : `Expand ${agent.label}`}
		onclick={onToggleExpanded}
	>
		{#if expanded}
			<ChevronDownIcon size={14} strokeWidth={1.9} aria-hidden="true" />
		{:else}
			<ChevronRightIcon size={14} strokeWidth={1.9} aria-hidden="true" />
		{/if}
	</button>
</div>
<textarea
	class="workflow-instructions-field"
	value={formState.current.values.instructions}
	aria-label={`${agent.label} instructions`}
	disabled={disabled}
	oninput={(event) => form.setFieldValue("instructions", event.currentTarget.value)}
	onblur={submit}
></textarea>
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

	.agent-drag-placeholder {
		cursor: default;
		opacity: 0.72;
	}

	.agent-expand-button {
		cursor: pointer;
	}

	.agent-expand-button:hover,
	.agent-expand-button:focus-visible {
		outline: none;
		background: var(--ui-hover-bg);
		color: var(--ui-text-primary);
		box-shadow: var(--ui-focus-ring);
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

	.extensions-field {
		width: fit-content;
		max-width: clamp(5.8rem, 10vw, 6.8rem);
	}

	.extension-usage-summary {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.agent-form-actions {
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

	.agent-text-button:hover,
	.agent-text-button:focus-visible {
		outline: none;
		color: var(--ui-text-primary);
		box-shadow: var(--ui-focus-ring);
	}

	.agent-text-button:disabled {
		cursor: default;
		opacity: 0.36;
	}

	.workflow-instructions-field {
		box-sizing: border-box;
		width: 100%;
		min-height: 4rem;
		resize: vertical;
		padding: 0.42rem 0.5rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-bg-elevated) 84%, transparent);
		color: var(--ui-text-primary);
		font: inherit;
		font-size: var(--text-sm);
		line-height: 1.45;
	}

	.workflow-instructions-field:hover,
	.workflow-instructions-field:focus-visible {
		outline: none;
		border-color: color-mix(in oklab, var(--ui-accent) 36%, var(--ui-border-soft));
		box-shadow: var(--ui-focus-ring);
	}

	.agent-form-error {
		margin: 0 0 0 1.6rem;
		color: color-mix(in oklab, var(--ui-danger) 86%, var(--ui-text-primary));
		font-size: var(--text-xs);
	}
</style>
