<script lang="ts">
	import { createForm } from "@tanstack/svelte-form";
	import type {
		AmbientAgentResourceCategory,
		ApprovalMode,
		AppAppearance,
		AppPreferences,
		ExternalInstructionActor,
		ExternalInstructionControl,
		ExternalInstructionGlobalRootSetting,
		PreferredExternalEditor,
	} from "../shared/agent-settings";
	import {
		AMBIENT_AGENT_RESOURCE_CATEGORIES,
		DEFAULT_EXTERNAL_INSTRUCTION_ACTORS,
	} from "../shared/agent-settings";
	import type { GeneratedAgentContextExternalSource } from "../shared/generated-agent-context";
	import Button from "./ui/Button.svelte";
	import Checkbox from "./ui/Checkbox.svelte";
	import OpenExternalButton from "./ui/OpenExternalButton.svelte";

	type Props = {
		preferences: AppPreferences;
		workspaceKey?: string;
		externalInstructionSources?: readonly GeneratedAgentContextExternalSource[];
		onOpenExternalInstructionSource?: (path: string) => Promise<boolean>;
		onSave: (preferences: AppPreferences) => Promise<AppPreferences>;
	};

	const APPEARANCE_OPTIONS: Array<{ value: AppAppearance; label: string; summary: string }> = [
		{ value: "system", label: "System", summary: "Follow macOS" },
		{ value: "light", label: "Light", summary: "Always light" },
		{ value: "dark", label: "Dark", summary: "Always dark" },
	];
	const EXTERNAL_EDITOR_OPTIONS: Array<{ value: PreferredExternalEditor; label: string }> = [
		{ value: "system", label: "System default" },
		{ value: "code", label: "Visual Studio Code" },
		{ value: "cursor", label: "Cursor" },
		{ value: "zed", label: "Zed" },
		{ value: "sublime", label: "Sublime Text" },
		{ value: "custom", label: "Custom command" },
	];
	const APPROVAL_MODE_OPTIONS: Array<{ value: ApprovalMode; label: string }> = [
		{ value: "auto-review", label: "Auto-review" },
		{ value: "user", label: "User approval" },
		{ value: "full-access", label: "Full access" },
	];
	const AMBIENT_RESOURCE_LABELS: Record<AmbientAgentResourceCategory, string> = {
		callableCapabilities: "Callable capabilities",
		runtimeExtensionsAndPackages: "Extensions and packages",
		skills: "Skills",
		promptTemplates: "Prompt templates",
		commands: "Commands",
		hooks: "Hooks",
		uiResources: "UI resources",
		providerModelAdapters: "Provider and model adapters",
		credentials: "Credentials",
		executionPolicy: "Execution policy",
		runtimeState: "Runtime state",
	};

	let {
		preferences,
		workspaceKey = "",
		externalInstructionSources = [],
		onOpenExternalInstructionSource,
		onSave,
	}: Props = $props();
	let submitError = $state("");
	let saveMessage = $state("");
	let customRootPath = $state("");
	let customRootError = $state("");

	function copyPreferences(input: AppPreferences): AppPreferences {
		return {
			appAppearance: input.appAppearance,
			preferredExternalEditor: input.preferredExternalEditor,
			customExternalEditorCommand: input.customExternalEditorCommand,
			artifactDirectory: input.artifactDirectory,
			approvalMode: input.approvalMode,
			networkAccess: input.networkAccess,
			externalInstructions: {
				globalRoots: input.externalInstructions.globalRoots.map((root) => ({ ...root })),
				globalControls: copyExternalInstructionControls(
					input.externalInstructions.globalControls,
				),
				workspaceControls: Object.fromEntries(
					Object.entries(input.externalInstructions.workspaceControls).map(([key, controls]) => [
						key,
						copyExternalInstructionControls(controls),
					]),
				),
			},
			ambientAgentResources: {
				categories: Object.fromEntries(
					AMBIENT_AGENT_RESOURCE_CATEGORIES.map((category) => [
						category,
						{ enabled: input.ambientAgentResources.categories[category]?.enabled === true },
					]),
				) as AppPreferences["ambientAgentResources"]["categories"],
				enablements: input.ambientAgentResources.enablements.map((record) => ({
					...record,
					source: { ...record.source },
					scope: { ...record.scope },
					targets: record.targets.map((target) => ({ ...target })),
				})),
			},
		};
	}

	const form = createForm(() => ({
		defaultValues: copyPreferences(preferences),
		validators: {
			onChange: ({ value }) => {
				if (!value.artifactDirectory.trim()) {
					return "Artifact directory is required.";
				}
				if (
					value.preferredExternalEditor === "custom" &&
					!value.customExternalEditorCommand.trim()
				) {
					return "Custom editor command is required.";
				}
				return undefined;
			},
		},
		onSubmit: async ({ value, formApi }) => {
			submitError = "";
			saveMessage = "Saving";
			const saved = await onSave(copyPreferences(value));
			formApi.reset(copyPreferences(saved));
			saveMessage = "Saved";
			setTimeout(() => {
				if (saveMessage === "Saved") saveMessage = "";
			}, 1800);
		},
	}));

	const formState = form.useStore();

	function resetForm() {
		submitError = "";
		saveMessage = "";
		form.reset(copyPreferences(preferences));
	}

	function submit() {
		void form.handleSubmit().catch((error) => {
			submitError = error instanceof Error ? error.message : "Save failed";
			saveMessage = "";
		});
	}

	function setAmbientCategory(category: AmbientAgentResourceCategory, enabled: boolean) {
		form.setFieldValue("ambientAgentResources", {
			categories: {
				...formState.current.values.ambientAgentResources.categories,
				[category]: { enabled },
			},
			enablements: formState.current.values.ambientAgentResources.enablements,
		});
	}

	function copyExternalInstructionControls(
		controls: Record<string, ExternalInstructionControl>,
	): Record<string, ExternalInstructionControl> {
		return Object.fromEntries(
			Object.entries(controls).map(([path, control]) => [
				path,
				{
					enabled: control.enabled,
					actors: [...control.actors],
				},
			]),
		);
	}

	function controlForSource(source: GeneratedAgentContextExternalSource): ExternalInstructionControl {
		const bucket = controlBucketForSource(source);
		const persisted = bucket.controls[bucket.sourceKey];
		if (persisted) {
			return {
				enabled: persisted.enabled,
				actors: [...persisted.actors],
			};
		}
		return {
			enabled: source.enabled,
			actors: [...source.actors],
		};
	}

	function controlBucketForSource(source: GeneratedAgentContextExternalSource): {
		controls: Record<string, ExternalInstructionControl>;
		sourceKey: string;
		workspaceScoped: boolean;
	} {
		if (source.sourceGroup === "workspace_chain") {
			return {
				controls:
					formState.current.values.externalInstructions.workspaceControls[workspaceKey] ?? {},
				sourceKey: source.path,
				workspaceScoped: true,
			};
		}
		return {
			controls: formState.current.values.externalInstructions.globalControls,
			sourceKey: source.path,
			workspaceScoped: false,
		};
	}

	function setExternalInstructionControl(
		source: GeneratedAgentContextExternalSource,
		control: ExternalInstructionControl,
	) {
		const bucket = controlBucketForSource(source);
		const nextControls = {
			...bucket.controls,
			[bucket.sourceKey]: control,
		};
		if (bucket.workspaceScoped) {
			form.setFieldValue("externalInstructions", {
				...formState.current.values.externalInstructions,
				workspaceControls: {
					...formState.current.values.externalInstructions.workspaceControls,
					[workspaceKey]: nextControls,
				},
			});
			return;
		}
		form.setFieldValue("externalInstructions", {
			...formState.current.values.externalInstructions,
			globalControls: nextControls,
		});
	}

	function setExternalInstructionEnabled(
		source: GeneratedAgentContextExternalSource,
		enabled: boolean,
	) {
		setExternalInstructionControl(source, {
			...controlForSource(source),
			enabled,
		});
	}

	function setExternalInstructionActor(
		source: GeneratedAgentContextExternalSource,
		actor: ExternalInstructionActor,
		enabled: boolean,
	) {
		const control = controlForSource(source);
		const actors = new Set(control.actors);
		if (enabled) {
			actors.add(actor);
		} else {
			actors.delete(actor);
		}
		setExternalInstructionControl(source, {
			...control,
			actors: [...actors].filter((candidate) =>
				DEFAULT_EXTERNAL_INSTRUCTION_ACTORS.includes(candidate),
			),
		});
	}

	function setGlobalRootEnabled(root: ExternalInstructionGlobalRootSetting, enabled: boolean) {
		form.setFieldValue("externalInstructions", {
			...formState.current.values.externalInstructions,
			globalRoots: formState.current.values.externalInstructions.globalRoots.map((candidate) =>
				candidate.id === root.id ? { ...candidate, enabled } : candidate,
			),
		});
	}

	function addCustomRoot() {
		const path = customRootPath.trim();
		if (!path) {
			customRootError = "Directory is required";
			return;
		}
		customRootError = "";
		const id = `custom-${Date.now().toString(36)}`;
		form.setFieldValue("externalInstructions", {
			...formState.current.values.externalInstructions,
			globalRoots: [
				...formState.current.values.externalInstructions.globalRoots,
				{
					id,
					kind: "custom",
					label: path.split(/[\\/]/).filter(Boolean).at(-1) ?? "Custom",
					path,
					enabled: true,
				},
			],
		});
		customRootPath = "";
	}

	function removeCustomRoot(rootId: string) {
		form.setFieldValue("externalInstructions", {
			...formState.current.values.externalInstructions,
			globalRoots: formState.current.values.externalInstructions.globalRoots.filter(
				(root) => root.id !== rootId || root.kind !== "custom",
			),
		});
	}

	const enabledGlobalRootCount = $derived(
		formState.current.values.externalInstructions.globalRoots.filter((root) => root.enabled)
			.length,
	);

	const hasUnsavedChanges = $derived(formState.current.isDirty);
	const formErrors = $derived(formState.current.errors.filter(Boolean));
</script>

<div class="settings-row-stack">
	<article class="provider-row general-row">
		<div class="provider-main general-main">
			<div class="provider-heading">
				<span class="provider-name">Appearance</span>
				<span class="provider-status tone-info">{formState.current.values.appAppearance}</span>
			</div>
			<p class="provider-meta general-meta">Choose the app color theme.</p>
		</div>
		<div class="appearance-options" role="radiogroup" aria-label="Appearance">
			{#each APPEARANCE_OPTIONS as option (option.value)}
				<label class={`appearance-option ${formState.current.values.appAppearance === option.value ? "selected" : ""}`.trim()}>
					<input
						type="radio"
						name="appAppearance"
						value={option.value}
						checked={formState.current.values.appAppearance === option.value}
						disabled={formState.current.isSubmitting}
						onchange={() => form.setFieldValue("appAppearance", option.value)}
					/>
					<span>{option.label}</span>
					<small>{option.summary}</small>
				</label>
			{/each}
		</div>
	</article>
	<article class="provider-row general-row">
		<div class="provider-main general-main">
			<div class="provider-heading">
				<span class="provider-name">External Editor</span>
				<span class="provider-status tone-info">{formState.current.values.preferredExternalEditor}</span>
			</div>
			<p class="provider-meta general-meta">Choose which editor opens workspace files from product surfaces.</p>
		</div>
		<div class="editor-grid">
			<label class="settings-field">
				<span>Editor</span>
				<select
					value={formState.current.values.preferredExternalEditor}
					disabled={formState.current.isSubmitting}
					onchange={(event) =>
						form.setFieldValue("preferredExternalEditor", event.currentTarget.value as PreferredExternalEditor)}
				>
					{#each EXTERNAL_EDITOR_OPTIONS as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</label>
			<label class="settings-field">
				<span>Custom command</span>
				<input
					value={formState.current.values.customExternalEditorCommand}
					placeholder="editor-command --reuse-window"
					disabled={formState.current.values.preferredExternalEditor !== "custom" || formState.current.isSubmitting}
					oninput={(event) => form.setFieldValue("customExternalEditorCommand", event.currentTarget.value)}
				/>
			</label>
		</div>
	</article>
	<article class="provider-row general-row">
		<div class="provider-main general-main">
			<div class="provider-heading">
				<span class="provider-name">Artifact Directory</span>
			</div>
			<p class="provider-meta general-meta">Choose where durable session artifact files are stored.</p>
		</div>
		<label class="settings-field settings-field-wide">
			<span>Directory</span>
			<input
				value={formState.current.values.artifactDirectory}
				placeholder="~/.config/svvy/artifacts"
				disabled={formState.current.isSubmitting}
				oninput={(event) => form.setFieldValue("artifactDirectory", event.currentTarget.value)}
			/>
		</label>
	</article>
	<article class="provider-row general-row">
		<div class="provider-main general-main">
			<div class="provider-heading">
				<span class="provider-name">Approval Mode</span>
				<span class="provider-status tone-info">{formState.current.values.approvalMode}</span>
			</div>
			<p class="provider-meta general-meta">Choose how execution-boundary requests are handled.</p>
		</div>
		<label class="settings-field settings-field-wide">
			<span>Mode</span>
			<select
				value={formState.current.values.approvalMode}
				disabled={formState.current.isSubmitting}
				onchange={(event) => form.setFieldValue("approvalMode", event.currentTarget.value as ApprovalMode)}
			>
				{#each APPROVAL_MODE_OPTIONS as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>
		</label>
	</article>
	<article class="provider-row general-row">
		<div class="provider-main general-main">
			<div class="provider-heading">
				<span class="provider-name">Network Access</span>
				<span class="provider-status tone-info">{formState.current.values.networkAccess ? "Enabled" : "Disabled"}</span>
			</div>
			<p class="provider-meta general-meta">Allow Shell commands to use network connections.</p>
		</div>
		<label class="settings-checkbox">
			<Checkbox
				checked={formState.current.values.networkAccess}
				disabled={formState.current.isSubmitting}
				onchange={(event) => form.setFieldValue("networkAccess", (event.currentTarget as HTMLInputElement).checked)}
			/>
			<span>{formState.current.values.networkAccess ? "Network allowed" : "Network blocked"}</span>
		</label>
	</article>
	<article class="provider-row general-row external-instructions-row">
		<div class="provider-main general-main">
			<div class="provider-heading">
				<span class="provider-name">External Instructions</span>
				<span class="provider-status tone-info">{enabledGlobalRootCount} roots</span>
			</div>
			<p class="provider-meta general-meta">Manage read-only AGENTS.md and CLAUDE.md inputs.</p>
		</div>
		<div class="external-instructions-panel">
			<div class="external-root-list" aria-label="External instruction global roots">
				{#each formState.current.values.externalInstructions.globalRoots as root (root.id)}
					<div class="external-root-row">
						<label class="settings-checkbox">
							<Checkbox
								checked={root.enabled}
								disabled={formState.current.isSubmitting}
								onchange={(event) => setGlobalRootEnabled(root, (event.currentTarget as HTMLInputElement).checked)}
							/>
							<span>{root.label}</span>
						</label>
						<code>{root.path}</code>
						{#if root.kind === "custom"}
							<Button
								variant="ghost"
								size="sm"
								onclick={() => removeCustomRoot(root.id)}
								disabled={formState.current.isSubmitting}
							>
								Remove
							</Button>
						{/if}
					</div>
				{/each}
			</div>
			<div class="custom-root-row">
				<label class="settings-field">
					<span>Custom root</span>
					<input
						value={customRootPath}
						placeholder="/path/to/standards"
						disabled={formState.current.isSubmitting}
						oninput={(event) => {
							customRootPath = event.currentTarget.value;
							customRootError = "";
						}}
					/>
				</label>
				<Button
					variant="ghost"
					size="sm"
					onclick={addCustomRoot}
					disabled={formState.current.isSubmitting}
				>
					Add Root
				</Button>
			</div>
			{#if customRootError}
				<span class="save-msg tone-danger">{customRootError}</span>
			{/if}
			<div class="external-source-list" aria-label="Discovered external instruction files">
				{#if externalInstructionSources.length === 0}
					<p class="provider-meta">No external instruction files are discovered for this workspace.</p>
				{:else}
					{#each externalInstructionSources as source (source.id)}
						<div class="external-source-row">
							<div class="external-source-main">
								<label class="settings-checkbox">
								<Checkbox
										checked={controlForSource(source).enabled}
										disabled={formState.current.isSubmitting}
										onchange={(event) => setExternalInstructionEnabled(source, (event.currentTarget as HTMLInputElement).checked)}
									/>
									<span>{source.kind}</span>
								</label>
								<code>{source.path}</code>
								<span class={`provider-status ${source.readStatus.status === "readable" ? "tone-info" : "tone-danger"}`.trim()}>
									{source.readStatus.status}
								</span>
							</div>
							<div class="actor-chip-row" aria-label={`${source.kind} actors`}>
								{#each DEFAULT_EXTERNAL_INSTRUCTION_ACTORS as actor (actor)}
									<label class="actor-chip">
										<input
											type="checkbox"
											checked={controlForSource(source).actors.includes(actor)}
											disabled={formState.current.isSubmitting}
											onchange={(event) => setExternalInstructionActor(source, actor, (event.currentTarget as HTMLInputElement).checked)}
										/>
										<span>{actor}</span>
									</label>
								{/each}
								{#if onOpenExternalInstructionSource}
									<OpenExternalButton
										size="sm"
										editor={formState.current.values.preferredExternalEditor}
										targetLabel={source.path}
										onclick={() => void onOpenExternalInstructionSource?.(source.path)}
									/>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</article>
	<article class="provider-row general-row">
		<div class="provider-main general-main">
			<div class="provider-heading">
				<span class="provider-name">Ambient Agent Resources</span>
				<span class="provider-status tone-info">
					{Object.values(formState.current.values.ambientAgentResources.categories).filter((category) => category.enabled).length} enabled
				</span>
			</div>
			<p class="provider-meta general-meta">Control host resource categories before source, workspace, and profile binding.</p>
		</div>
		<div class="ambient-resource-list" aria-label="Ambient agent resource categories">
			{#each AMBIENT_AGENT_RESOURCE_CATEGORIES as category (category)}
				<label class="settings-checkbox ambient-resource-item">
					<Checkbox
						checked={formState.current.values.ambientAgentResources.categories[category]?.enabled === true}
						disabled={formState.current.isSubmitting}
						onchange={(event) => setAmbientCategory(category, (event.currentTarget as HTMLInputElement).checked)}
					/>
					<span>{AMBIENT_RESOURCE_LABELS[category]}</span>
				</label>
			{/each}
		</div>
	</article>
</div>

<style>
	.settings-row-stack {
		display: grid;
		gap: 0.72rem;
	}

	.provider-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
		align-items: center;
		gap: 0.72rem;
		padding: 0.72rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: var(--ui-radius-md);
		background: color-mix(in oklab, var(--ui-surface-subtle) 70%, transparent);
	}

	.provider-main {
		display: grid;
		gap: 0.26rem;
		min-width: 0;
	}

	.provider-heading {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		flex-wrap: wrap;
	}

	.provider-name {
		font-size: var(--text-sm);
		font-weight: 650;
		color: var(--ui-text-primary);
	}

	.provider-status {
		display: inline-flex;
		align-items: center;
		border: 1px solid color-mix(in oklab, currentColor 16%, transparent);
		border-radius: 999px;
		padding: 0.08rem 0.38rem;
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--ui-text-secondary);
		background: color-mix(in oklab, currentColor 8%, transparent);
	}

	.provider-status.tone-info {
		color: color-mix(in oklab, var(--ui-info) 74%, var(--ui-text-primary));
	}

	.provider-status.tone-danger {
		color: color-mix(in oklab, var(--ui-danger) 84%, var(--ui-text-primary));
	}

	.provider-meta {
		margin: 0;
		font-size: var(--text-xs);
		line-height: 1.35;
		color: var(--ui-text-secondary);
	}

	.provider-meta.general-meta {
		display: block;
	}

	.appearance-options {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.45rem;
	}

	.appearance-option {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.06rem 0.42rem;
		align-items: center;
		min-width: 0;
		padding: 0.5rem 0.58rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-surface-subtle) 68%, transparent);
		cursor: pointer;
		transition:
			border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 150ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.appearance-option:hover {
		border-color: color-mix(in oklab, var(--ui-border-strong) 82%, transparent);
		background: var(--ui-hover-bg);
	}

	.appearance-option.selected {
		border-color: var(--ui-selected-border);
		background: var(--ui-selected-bg);
	}

	.appearance-option input {
		grid-row: 1 / span 2;
		accent-color: var(--ui-accent);
	}

	.appearance-option span,
	.appearance-option small {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.appearance-option span {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ui-text-primary);
	}

	.appearance-option small {
		font-size: var(--text-xs);
		color: var(--ui-text-secondary);
	}

	.editor-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(12rem, 1fr);
		gap: 0.54rem;
	}

	.settings-field {
		display: grid;
		gap: 0.28rem;
		min-width: 0;
	}

	.settings-field span {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--ui-text-secondary);
	}

	.settings-field select,
	.settings-field input {
		width: 100%;
		min-width: 0;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: var(--ui-radius-sm);
		padding: 0.38rem 0.48rem;
		background: color-mix(in oklab, var(--ui-surface-subtle) 82%, transparent);
		color: var(--ui-text-primary);
		font: inherit;
		font-size: var(--text-sm);
	}

	.settings-field select:disabled,
	.settings-field input:disabled {
		color: var(--ui-text-tertiary);
		cursor: default;
		opacity: 0.72;
	}

	.settings-checkbox {
		display: inline-flex;
		align-items: center;
		gap: 0.46rem;
		color: var(--ui-text-secondary);
		font-size: var(--text-sm);
		white-space: nowrap;
	}

	.external-instructions-row {
		align-items: start;
	}

	.external-instructions-panel {
		display: grid;
		gap: 0.58rem;
		min-width: 0;
	}

	.external-root-list,
	.external-source-list {
		display: grid;
		gap: 0.38rem;
		min-width: 0;
	}

	.external-root-row,
	.custom-root-row,
	.external-source-row {
		display: grid;
		gap: 0.42rem;
		min-width: 0;
		padding: 0.5rem 0.58rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-surface-subtle) 58%, transparent);
	}

	.external-root-row {
		grid-template-columns: minmax(8rem, auto) minmax(0, 1fr) auto;
		align-items: center;
	}

	.custom-root-row {
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: end;
	}

	.external-source-main,
	.actor-chip-row {
		display: flex;
		align-items: center;
		gap: 0.42rem;
		min-width: 0;
		flex-wrap: wrap;
	}

	.external-root-row code,
	.external-source-main code {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ui-text-tertiary);
	}

	.actor-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.26rem;
		min-height: 1.55rem;
		padding: 0.12rem 0.38rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 84%, transparent);
		border-radius: var(--ui-radius-sm);
		color: var(--ui-text-secondary);
		background: color-mix(in oklab, var(--ui-panel) 62%, transparent);
		font-size: var(--text-xs);
	}

	.actor-chip input {
		accent-color: var(--ui-accent);
	}

	.ambient-resource-list {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.52rem 0.74rem;
	}

	.ambient-resource-item {
		min-width: 0;
		white-space: normal;
	}

	.preferences-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.42rem;
		margin-top: 0.78rem;
		flex-wrap: wrap;
	}

	.preferences-status {
		margin-right: auto;
		min-height: 1.35rem;
	}

	.save-msg {
		color: var(--ui-accent-strong);
		font-size: var(--text-xs);
		font-family: var(--font-mono);
	}

	.save-msg.tone-danger {
		color: color-mix(in oklab, var(--ui-danger) 84%, var(--ui-text-primary));
	}

	@media (max-width: 760px) {
		.provider-row {
			grid-template-columns: 1fr;
		}

		.editor-grid {
			grid-template-columns: 1fr;
		}

		.external-root-row,
		.custom-root-row {
			grid-template-columns: 1fr;
		}
	}
</style>
<div class="preferences-actions">
	<div class="preferences-status" aria-live="polite">
		{#if submitError || formErrors.length > 0}
			<span class="save-msg tone-danger">{submitError || formErrors.join(" ")}</span>
		{:else if saveMessage}
			<span class="save-msg">{saveMessage}</span>
		{:else if hasUnsavedChanges}
			<span class="save-msg">Unsaved changes</span>
		{/if}
	</div>
	<Button
		variant="ghost"
		size="sm"
		onclick={resetForm}
		disabled={!hasUnsavedChanges || formState.current.isSubmitting}
	>
		Reset
	</Button>
	<Button
		variant="ghost"
		size="sm"
		onclick={resetForm}
		disabled={!hasUnsavedChanges || formState.current.isSubmitting}
	>
		Cancel
	</Button>
	<Button
		variant="primary"
		size="sm"
		onclick={submit}
		disabled={!formState.current.canSubmit || !hasUnsavedChanges || formState.current.isSubmitting}
	>
		{formState.current.isSubmitting ? "Saving" : "Save Changes"}
	</Button>
</div>
