<script lang="ts">
	import AlertCircleIcon from "@lucide/svelte/icons/alert-circle";
	import CheckIcon from "@lucide/svelte/icons/check";
	import CheckCircle2Icon from "@lucide/svelte/icons/check-circle-2";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
	import CircleDashedIcon from "@lucide/svelte/icons/circle-dashed";
	import CopyPlusIcon from "@lucide/svelte/icons/copy-plus";
	import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
	import LockIcon from "@lucide/svelte/icons/lock";
	import Trash2Icon from "@lucide/svelte/icons/trash-2";
	import { createForm } from "@tanstack/svelte-form";
	import type { ReasoningEffort, WorkflowAgentSettings } from "../shared/agent-settings";
	import type { AgentModelChoice } from "../shared/workspace-contract";
	import {
		isFileBackedEditConflictError,
		type FileBackedSaveMode,
	} from "../shared/file-backed-edit";
	import CompactCombobox, { type CompactComboboxOption } from "./ui/CompactCombobox.svelte";
	import CompactSelect, { type CompactSelectOption } from "./ui/CompactSelect.svelte";
	import ExtensionUsageControl from "./ExtensionUsageControl.svelte";
	import type { ExtensionUsageControlItem } from "./agents-pane-extension-usage";
	import FileBackedConflictActions from "./ui/FileBackedConflictActions.svelte";
	import Input from "./ui/Input.svelte";
	import Tooltip from "./ui/Tooltip.svelte";
	import { dismissConfirmation } from "./ui/dismiss-confirmation";

	type WorkflowFormValues = {
		instructions: string;
		label: string;
		modelValue: string;
		reasoningEffort: ReasoningEffort;
	};

	type AutosaveStatus = "conflict" | "error" | "saved" | "saving" | "unsaved";

	type SaveWorkflowAgentOptions = {
		baseSourceVersion?: string;
		mode?: FileBackedSaveMode;
	};

	const AUTOSAVE_DELAY_MS = 700;

	type Props = {
		agent: WorkflowAgentSettings;
		confirmingDelete: boolean;
		deleting: boolean;
		expanded: boolean;
		isDefault: boolean;
		modelChoices: AgentModelChoice[];
		saving: boolean;
		extensionUsageItems: ExtensionUsageControlItem[];
		onCancelDelete: () => void;
		onConfirmDelete: () => void;
		onDuplicate: () => void;
		onOpenExtension: (extensionId: string) => void;
		onInstructionsChange?: (instructions: string) => void;
		onRequestDelete: () => void;
		onSave: (
			agent: WorkflowAgentSettings,
			options?: SaveWorkflowAgentOptions,
		) => Promise<WorkflowAgentSettings>;
		onSetExtensionUsage: (
			extensionId: string,
			state: ExtensionUsageControlItem["state"],
		) => Promise<WorkflowAgentSettings>;
		onSetExtensionDefault: (
			extensionId: string,
			state: ExtensionUsageControlItem["state"],
		) => Promise<void>;
		onToggleExpanded: () => void;
	};

	let {
		agent,
		confirmingDelete,
		deleting,
		expanded,
		isDefault,
		modelChoices,
		saving,
		extensionUsageItems,
		onCancelDelete,
		onConfirmDelete,
		onDuplicate,
		onOpenExtension,
		onInstructionsChange,
		onRequestDelete,
		onSave,
		onSetExtensionUsage,
		onSetExtensionDefault,
		onToggleExpanded,
	}: Props = $props();
	let submitError = $state("");
	let baseSourceVersion = $state<string | undefined>(undefined);
	let conflictAgent = $state<WorkflowAgentSettings | null>(null);

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
			const submittedValue = { ...value };
			const choice = selectedChoice(value.modelValue);
			const fallback = providerModelFrom(value.modelValue);
			const next: WorkflowAgentSettings = {
				...agent,
				label: value.label.trim(),
				provider: choice?.providerId ?? fallback.provider,
				model: choice?.modelId ?? fallback.model,
				reasoningEffort: value.reasoningEffort,
				instructions: value.instructions,
				extensions: [...agent.extensions],
				extensionUsage: { ...agent.extensionUsage },
			};
			const saved = await onSave(next, {
				baseSourceVersion,
				mode: "compare-and-swap",
			});
			baseSourceVersion = saved.sourceVersion;
			conflictAgent = null;
			if (formValuesEqual(formState.current.values, submittedValue)) {
				formApi.reset(valuesFor(saved));
			}
		},
	}));

	const formState = form.useStore();
	const controlsDisabled = $derived(deleting);
	const instructionsDisabled = $derived(deleting);
	const formErrors = $derived(formState.current.errors.filter(Boolean));
	const autosaveStatus = $derived<AutosaveStatus>(
		conflictAgent
			? "conflict"
			: submitError || formErrors.length > 0
				? "error"
				: formState.current.isSubmitting || saving
				? "saving"
				: formState.current.isDirty
					? "unsaved"
					: "saved",
	);

	$effect(() => {
		onInstructionsChange?.(formState.current.values.instructions);
	});

	$effect(() => {
		const nextSourceVersion = agent.sourceVersion;
		if (nextSourceVersion === baseSourceVersion) return;
		if (formState.current.isDirty) {
			if (!conflictAgent || conflictAgent.sourceVersion !== nextSourceVersion) {
				conflictAgent = agent;
			}
			return;
		}
		baseSourceVersion = nextSourceVersion;
		conflictAgent = null;
		form.reset(valuesFor(agent));
	});

	$effect(() => {
		const scheduledValue = { ...formState.current.values };
		if (conflictAgent || !formState.current.isDirty || formState.current.isSubmitting || deleting) {
			return;
		}
		const autosaveTimer = setTimeout(() => {
			if (!formValuesEqual(formState.current.values, scheduledValue) && !formState.current.isDirty) {
				return;
			}
			submit();
		}, AUTOSAVE_DELAY_MS);
		return () => clearTimeout(autosaveTimer);
	});

	function formValuesEqual(left: WorkflowFormValues, right: WorkflowFormValues): boolean {
		return (
			left.instructions === right.instructions &&
			left.label === right.label &&
			left.modelValue === right.modelValue &&
			left.reasoningEffort === right.reasoningEffort
		);
	}

	function autosaveStatusLabel(status: AutosaveStatus): string {
		if (status === "conflict") return "File changed outside svvy";
		if (status === "error") return "Autosave failed";
		if (status === "saving") return "Saving changes";
		if (status === "unsaved") return "Unsaved changes";
		return "Saved";
	}

	function submit() {
		if (conflictAgent || !formState.current.isDirty || formState.current.isSubmitting) return;
		void form.handleSubmit().catch((error) => {
			if (isFileBackedEditConflictError<WorkflowAgentSettings>(error)) {
				conflictAgent = error.conflict.current;
				return;
			}
			submitError = error instanceof Error ? error.message : "Unable to save workflow agent.";
		});
	}

	function submitSoon() {
		queueMicrotask(submit);
	}

	function resetForm() {
		submitError = "";
		conflictAgent = null;
		baseSourceVersion = agent.sourceVersion;
		form.reset(valuesFor(agent));
	}

	function discardLocalConflict() {
		const current = conflictAgent ?? agent;
		submitError = "";
		baseSourceVersion = current.sourceVersion;
		conflictAgent = null;
		form.reset(valuesFor(current));
	}

	async function overwriteExternalConflict() {
		if (!conflictAgent || formState.current.isSubmitting) return;
		submitError = "";
		const value = { ...formState.current.values };
		const choice = selectedChoice(value.modelValue);
		const fallback = providerModelFrom(value.modelValue);
		const next: WorkflowAgentSettings = {
			...agent,
			label: value.label.trim(),
			provider: choice?.providerId ?? fallback.provider,
			model: choice?.modelId ?? fallback.model,
			reasoningEffort: value.reasoningEffort,
			instructions: value.instructions,
			extensions: [...agent.extensions],
			extensionUsage: { ...agent.extensionUsage },
		};
		try {
			const saved = await onSave(next, {
				baseSourceVersion,
				mode: "overwrite",
			});
			baseSourceVersion = saved.sourceVersion;
			conflictAgent = null;
			if (formValuesEqual(formState.current.values, value)) {
				form.reset(valuesFor(saved));
			}
		} catch (error) {
			if (isFileBackedEditConflictError<WorkflowAgentSettings>(error)) {
				conflictAgent = error.conflict.current;
				return;
			}
			submitError = error instanceof Error ? error.message : "Unable to overwrite workflow agent.";
		}
	}

	async function saveExtensionUsage(extensionId: string, state: ExtensionUsageControlItem["state"]) {
		submitError = "";
		await onSetExtensionUsage(extensionId, state);
	}
</script>

<div class="agent-profile-main">
	<span class="agent-drag-placeholder">
		{#if isDefault}
			<LockIcon size={12} aria-hidden="true" />
		{/if}
	</span>
	<Input
		value={formState.current.values.label}
		class="agent-name-input"
		aria-label={`${agent.label} label`}
		disabled={controlsDisabled}
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
				ariaLabel={`${agent.label} reasoning`}
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
				ariaLabel={`${agent.label} extension usage`}
				actor="workflow-task"
				disabled={controlsDisabled}
				items={extensionUsageItems}
				onOpenExtension={onOpenExtension}
				onSetExtensionDefault={onSetExtensionDefault}
				onStateChange={saveExtensionUsage}
			/>
		</div>
		<div
			class="agent-row-actions"
			use:dismissConfirmation={{
				active: confirmingDelete,
				onDismiss: onCancelDelete,
			}}
		>
			<Tooltip label="Duplicate workflow agent">
				<button
					type="button"
					class="agent-icon-button"
					aria-label={`Duplicate ${agent.label}`}
					disabled={controlsDisabled}
					onclick={onDuplicate}
				>
					<CopyPlusIcon size={13} aria-hidden="true" />
				</button>
			</Tooltip>
			{#if confirmingDelete}
				<Tooltip label="Confirm delete">
					<button
						type="button"
						class="agent-icon-button danger"
						aria-label={`Confirm deleting ${agent.label}`}
						disabled={controlsDisabled}
						onclick={onConfirmDelete}
					>
						<CheckIcon size={13} aria-hidden="true" />
					</button>
				</Tooltip>
			{:else}
				<Tooltip label={isDefault ? "Default workflow agent cannot be deleted" : "Delete workflow agent"}>
					<button
						type="button"
						class="agent-icon-button danger"
						aria-label={`Delete ${agent.label}`}
						disabled={isDefault || controlsDisabled}
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
<div class="workflow-instructions-shell" data-autosave-status={autosaveStatus}>
	<textarea
		class="workflow-instructions-field"
		value={formState.current.values.instructions}
		aria-label={`${agent.label} instructions`}
		disabled={instructionsDisabled}
		oninput={(event) => form.setFieldValue("instructions", event.currentTarget.value)}
		onblur={submit}
	></textarea>
	<div class="workflow-autosave-tooltip">
		{#if autosaveStatus === "conflict"}
			<FileBackedConflictActions
				disabled={formState.current.isSubmitting || saving}
				onDiscard={discardLocalConflict}
				onOverwrite={() => void overwriteExternalConflict()}
			/>
		{:else}
			<Tooltip label={autosaveStatusLabel(autosaveStatus)}>
				<span
					class="workflow-autosave-status"
					role="status"
					aria-live="polite"
					aria-label={autosaveStatusLabel(autosaveStatus)}
				>
					<span class="workflow-autosave-icon icon-error">
						<AlertCircleIcon size={13} strokeWidth={2} aria-hidden="true" />
					</span>
					<span class="workflow-autosave-icon workflow-autosave-spinner icon-saving">
						<LoaderCircleIcon size={13} strokeWidth={2} aria-hidden="true" />
					</span>
					<span class="workflow-autosave-icon icon-unsaved">
						<CircleDashedIcon size={13} strokeWidth={2} aria-hidden="true" />
					</span>
					<span class="workflow-autosave-icon icon-saved">
						<CheckCircle2Icon size={13} strokeWidth={2} aria-hidden="true" />
					</span>
				</span>
			</Tooltip>
		{/if}
	</div>
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

	.agent-row-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.08rem;
		flex: 0 0 auto;
		min-height: var(--agent-row-line-height);
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
		box-shadow: var(--ui-focus-ring);
	}

	.agent-icon-button.danger:hover:not(:disabled),
	.agent-icon-button.danger:focus-visible:not(:disabled) {
		background: var(--ui-danger-soft);
		color: var(--ui-danger);
	}

	.agent-icon-button:disabled {
		cursor: default;
		opacity: 0.36;
	}

	.workflow-instructions-shell {
		position: relative;
	}

	.workflow-instructions-field {
		box-sizing: border-box;
		width: 100%;
		min-height: 4rem;
		resize: vertical;
		padding: 0.42rem 2rem 0.42rem 0.5rem;
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

	.workflow-instructions-shell :global(.workflow-autosave-tooltip) {
		position: absolute;
		top: 0.36rem;
		right: 0.36rem;
	}

	.workflow-autosave-status {
		position: relative;
		display: block;
		width: 1.28rem;
		height: 1.28rem;
		color: var(--ui-text-tertiary);
		opacity: 0.72;
		contain: layout paint style;
	}

	.workflow-autosave-icon {
		position: absolute;
		top: 50%;
		left: 50%;
		display: grid;
		place-items: center;
		opacity: 0;
		transform: translate(-50%, -50%);
		transition:
			opacity 120ms ease,
			color 120ms ease;
	}

	.workflow-autosave-icon :global(svg) {
		display: block;
	}

	.workflow-instructions-shell[data-autosave-status="saved"] .icon-saved {
		opacity: 1;
		color: color-mix(in oklab, var(--ui-success) 54%, var(--ui-text-tertiary));
	}

	.workflow-instructions-shell[data-autosave-status="saving"] .icon-saving {
		opacity: 1;
		color: color-mix(in oklab, var(--ui-accent) 68%, var(--ui-text-secondary));
	}

	.workflow-instructions-shell[data-autosave-status="unsaved"] .icon-unsaved {
		opacity: 1;
		color: var(--ui-text-tertiary);
	}

	.workflow-instructions-shell[data-autosave-status="error"] .icon-error {
		opacity: 1;
		color: color-mix(in oklab, var(--ui-danger) 76%, var(--ui-text-secondary));
	}

	.workflow-autosave-spinner {
		animation: workflow-autosave-spin 0.85s linear infinite;
	}

	@keyframes workflow-autosave-spin {
		to {
			transform: translate(-50%, -50%) rotate(360deg);
		}
	}

	.agent-form-error {
		margin: 0 0 0 1.6rem;
		color: color-mix(in oklab, var(--ui-danger) 86%, var(--ui-text-primary));
		font-size: var(--text-xs);
	}
</style>
