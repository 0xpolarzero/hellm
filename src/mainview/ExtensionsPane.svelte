<script lang="ts">
  import BanIcon from "@lucide/svelte/icons/ban";
  import CheckIcon from "@lucide/svelte/icons/check";
  import Code2Icon from "@lucide/svelte/icons/code-2";
  import CopyPlusIcon from "@lucide/svelte/icons/copy-plus";
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import SaveIcon from "@lucide/svelte/icons/save";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { onDestroy, onMount, tick } from "svelte";
  import { flip } from "svelte/animate";
  import type {
    AgentSettingsState,
    AppPreferences,
    ExternalInstructionActor,
    ExternalInstructionControl,
    RequestUserInputSettings,
  } from "../shared/agent-settings";
  import { DEFAULT_EXTERNAL_INSTRUCTION_ACTORS } from "../shared/agent-settings";
  import type {
    AgentContextPreviewResponse,
    ExtensionCliRequirementReadiness,
    ExtensionEnvRequirementReadiness,
    ExtensionInventoryItemReadModel,
    ExtensionSnapshotReadModel,
    ExtensionsInventoryReadModel,
  } from "../shared/workspace-contract";
  import { BUILTIN_EXTENSIONS } from "../shared/extensions";
  import type { ExtensionInterfaceKind, ExtensionUsageState } from "../shared/extensions";
  import type { ChatRuntime } from "./chat-runtime";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import Checkbox from "./ui/Checkbox.svelte";
  import CompactCombobox, { type CompactComboboxOption } from "./ui/CompactCombobox.svelte";
  import OpenExternalButton from "./ui/OpenExternalButton.svelte";
  import Tooltip from "./ui/Tooltip.svelte";
  import { dismissConfirmation } from "./ui/dismiss-confirmation";
  import ExtensionEnvValueForm from "./ExtensionEnvValueForm.svelte";
  import ExtensionInstructionFileEditor from "./ExtensionInstructionFileEditor.svelte";
  import ExtensionListRow from "./ExtensionListRow.svelte";
  import ExtensionStateButtons from "./ExtensionStateButtons.svelte";
  import { queuedMessageOrderChanged, reorderQueuedMessageItems } from "./queued-message-order";

  type Props = {
    runtime: ChatRuntime;
    targetExtensionId?: string | null;
    targetView?: "inventory" | "generated-context-preview";
  };

  let { runtime, targetExtensionId = null, targetView = "inventory" }: Props = $props();
  let agentSettings = $state<AgentSettingsState | null>(null);
  let appPreferences = $state<AppPreferences | null>(null);
  let contextPreview = $state<AgentContextPreviewResponse | null>(null);
  let extensionsInventory = $state<ExtensionsInventoryReadModel | null>(null);
  let settingsError = $state<string | null>(null);
  let inventoryError = $state<string | null>(null);
  let pendingSettings = $state(false);
  let loadingPreview = $state(false);
  let loadingInventory = $state(true);
  let pendingExternalInstructionPath = $state<string | null>(null);
  let selectedSnapshotId = $state("");
  let snapshotName = $state("");
  let snapshotPopoverOpen = $state(false);
  let renamingSnapshotId = $state<string | null>(null);
  let renameSnapshotName = $state("");
  let confirmingDeleteSnapshotId = $state<string | null>(null);
  let snapshotAction = $state<"save" | "rename" | "delete" | "load" | null>(null);
  let snapshotNameInput = $state<HTMLInputElement | null>(null);
  let renameSnapshotInput = $state<HTMLInputElement | null>(null);
  let expandedExtensionIds = $state<Set<string>>(new Set());
  let extensionFilter = $state<"all" | ExtensionInterfaceKind>("all");
  let pendingDefaultUsageKey = $state<string | null>(null);
  let pendingExtensionAction = $state<string | null>(null);
  let newExtensionOpen = $state(false);
  let newExtensionTitle = $state("");
  let newExtensionDescription = $state("");
  let extensionListElement = $state<HTMLElement | null>(null);
  let extensionDrag = $state<{
    extensionId: string;
    pointerId: number;
    startY: number;
    didMove: boolean;
  } | null>(null);
  let dragCaptureElement: HTMLElement | null = null;
  let draggedExtensionId = $state<string | null>(null);
  let dropBeforeExtensionId = $state<string | null>(null);
  const extensionRowElements = new Map<string, HTMLElement>();

  const ACTORS = [
    { id: "orchestrator", label: "Orchestrator" },
    { id: "handler", label: "Handler" },
    { id: "workflow-task", label: "Workflow Task" },
  ] as const;

  const DEFAULT_ACTORS = [
    { id: "orchestrator", label: "Orchestrator" },
    { id: "workflow-task", label: "Workflow Task" },
  ] as const;

  const USAGE_STATES: Array<{ state: ExtensionUsageState; label: string }> = [
    { state: "default_loaded", label: "Loaded" },
    { state: "available", label: "Available" },
    { state: "unavailable", label: "Off" },
  ];

  const FILTERS: Array<{ id: "all" | ExtensionInterfaceKind; label: string }> = [
    { id: "all", label: "All" },
    { id: "instructions", label: "Prompt" },
    { id: "native_tool", label: "Native" },
    { id: "svvyx", label: "svvyx" },
  ];

  function inventoryRows(): ExtensionInventoryItemReadModel[] {
    const rows = extensionsInventory
      ? extensionsInventory.extensions
      : BUILTIN_EXTENSIONS.map((extension) => ({
      id: extension.id,
      category: extension.category,
      interface: extension.interface,
      title: extension.title,
      description: extension.description,
      customized: false,
      minimalInstruction: {
        name: "minimal.md",
        path: "",
        content: extension.minimalLoadingHint,
        sourceVersion: "",
        skipped: false,
        editable: extension.interface !== "native_tool",
        tokenCount: {
          tokens: 0,
          accuracy: "estimated",
        },
      },
      loadedInstructionContributors: [],
      typescriptApiEnabled: extension.typescriptApiEnabled,
      tooling: {
        typescriptApiStatus: extension.typescriptApiEnabled ? "not_emitted" : "disabled",
      },
      usage: [],
      requirements: {
        cliRequirements: [],
        env: [],
      },
      state: {
        ready: true,
        issues: [],
      },
    }));
    return orderedInventoryRows(rows).filter(
      (extension) => extensionFilter === "all" || extension.interface === extensionFilter,
    );
  }

  function orderedInventoryRows(rows: ExtensionInventoryItemReadModel[]) {
    const order = extensionsInventory?.defaults?.order ?? BUILTIN_EXTENSIONS.map((extension) => extension.id);
    const orderById = new Map(order.map((id, index) => [id, index]));
    return reorderQueuedMessageItems(
      rows.toSorted((left, right) => {
        const leftOrder = orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
      }),
      draggedExtensionId,
      dropBeforeExtensionId,
    );
  }

  function registerExtensionRow(node: HTMLElement, extensionId: string) {
    extensionRowElements.set(extensionId, node);
    return {
      destroy() {
        if (extensionRowElements.get(extensionId) === node) {
          extensionRowElements.delete(extensionId);
        }
      },
    };
  }

  onDestroy(() => {
    removeExtensionDragListeners();
  });

  function toggleExtensionExpanded(extensionId: string) {
    if (expandedExtensionIds.has(extensionId)) {
      expandedExtensionIds.delete(extensionId);
    } else {
      expandedExtensionIds.add(extensionId);
    }
    expandedExtensionIds = new Set(expandedExtensionIds);
  }

  function defaultUsageFor(
    extension: ExtensionInventoryItemReadModel,
    actorKind: (typeof DEFAULT_ACTORS)[number]["id"],
  ) {
    return (
      extensionsInventory?.defaults?.usage[extension.id]?.find(
        (usage) => usage.actorKind === actorKind,
      ) ?? {
        actorKind,
        state: extension.category === "user" ? "default_loaded" : "unavailable",
        customized: false,
        configurable: extension.id !== "extension-loading",
      }
    );
  }

  async function setDefaultUsage(
    extension: ExtensionInventoryItemReadModel,
    actorKind: (typeof DEFAULT_ACTORS)[number]["id"],
    state: ExtensionUsageState,
  ) {
    const usage = defaultUsageFor(extension, actorKind);
    if (!usage.configurable || usage.state === state || pendingDefaultUsageKey !== null) return;
    pendingDefaultUsageKey = `${extension.id}:${actorKind}:${state}`;
    inventoryError = null;
    try {
      extensionsInventory = await runtime.setExtensionDefaultUsage({
        extensionId: extension.id,
        actorKind,
        state,
      });
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to update extension default.";
    } finally {
      pendingDefaultUsageKey = null;
    }
  }

  function extensionKindTitle(kind: ExtensionInterfaceKind): string {
    if (kind === "native_tool") return "Native tool";
    if (kind === "svvyx") return "svvyx extension";
    return "Prompt extension";
  }

  function extensionKindTooltip(kind: ExtensionInterfaceKind): string {
    if (kind === "native_tool") return "App-native tools expose builtin runtime capabilities.";
    if (kind === "svvyx") return "svvyx extensions expose app-owned Incur CLI commands.";
    return "Prompt extensions add instruction text and loading hints.";
  }

  function extensionTokenCount(extension: ExtensionInventoryItemReadModel): number {
    return extension.loadedInstructionContributors
      .filter((contributor) => !contributorSkipped(contributor))
      .reduce((total, contributor) => total + contributorTokenCount(contributor), 0);
  }

  function contributorSkipped(
    contributor: ExtensionInventoryItemReadModel["loadedInstructionContributors"][number],
  ): boolean {
    return contributor.kind === "source" ? contributor.file.skipped : contributor.skipped;
  }

  function contributorTokenCount(
    contributor: ExtensionInventoryItemReadModel["loadedInstructionContributors"][number],
  ): number {
    return contributor.kind === "source"
      ? contributor.file.tokenCount.tokens
      : contributor.output.tokenCount.tokens;
  }

  function formatPromptTokenCount(tokens: number): string {
    return `~${tokens.toLocaleString()} tokens`;
  }

  function generatedApiLabel(extension: ExtensionInventoryItemReadModel): string | null {
    if (!extension.typescriptApiEnabled) return null;
    return "TS API";
  }

  function customizedExtension(extension: ExtensionInventoryItemReadModel): boolean {
    return extension.customized;
  }

  function newExtensionId(title: string): string {
    return title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^[^a-z]+/, "") || "extension";
  }

  async function createExtension() {
    const title = newExtensionTitle.trim();
    if (!title || pendingExtensionAction) return;
    const id = newExtensionId(title);
    pendingExtensionAction = "new";
    inventoryError = null;
    try {
      extensionsInventory = await runtime.createExtension({
        id,
        title,
        description: newExtensionDescription.trim() || `${title} prompt extension.`,
      });
      newExtensionTitle = "";
      newExtensionDescription = "";
      newExtensionOpen = false;
      expandedExtensionIds.add(id);
      expandedExtensionIds = new Set(expandedExtensionIds);
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Unable to create extension.";
    } finally {
      pendingExtensionAction = null;
    }
  }

  async function duplicateExtension(extension: ExtensionInventoryItemReadModel) {
    if (pendingExtensionAction || extension.interface === "native_tool") return;
    const title = `${extension.title} Copy`;
    const id = uniqueExtensionId(newExtensionId(title));
    pendingExtensionAction = `duplicate:${extension.id}`;
    inventoryError = null;
    try {
      extensionsInventory = await runtime.duplicateExtension({
        extensionId: extension.id,
        id,
        title,
      });
      expandedExtensionIds.add(id);
      expandedExtensionIds = new Set(expandedExtensionIds);
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Unable to duplicate extension.";
    } finally {
      pendingExtensionAction = null;
    }
  }

  function uniqueExtensionId(base: string): string {
    const existing = new Set(inventoryRows().map((extension) => extension.id));
    if (!existing.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base}-${index}`;
      if (!existing.has(candidate)) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  async function deleteExtension(extension: ExtensionInventoryItemReadModel) {
    if (pendingExtensionAction || extension.category === "builtin") return;
    pendingExtensionAction = `delete:${extension.id}`;
    inventoryError = null;
    try {
      extensionsInventory = await runtime.deleteExtension({ extensionId: extension.id });
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Unable to delete extension.";
    } finally {
      pendingExtensionAction = null;
    }
  }

  async function resetExtension(extension: ExtensionInventoryItemReadModel) {
    if (pendingExtensionAction || extension.category !== "builtin") return;
    pendingExtensionAction = `reset:${extension.id}`;
    inventoryError = null;
    try {
      extensionsInventory = await runtime.resetExtension({ extensionId: extension.id });
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Unable to reset extension.";
    } finally {
      pendingExtensionAction = null;
    }
  }

  async function buildExtension(extensionId: string) {
    if (pendingExtensionAction) return;
    pendingExtensionAction = `build:${extensionId}`;
    inventoryError = null;
    try {
      extensionsInventory = await runtime.buildExtension({ extensionId });
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Unable to build extension.";
    } finally {
      pendingExtensionAction = null;
    }
  }

  async function addInstructionFile(extension: ExtensionInventoryItemReadModel) {
    if (pendingExtensionAction) return;
    const nextIndex = extension.loadedInstructionContributors.length + 1;
    const name = `${String(nextIndex * 10).padStart(3, "0")}-notes.md`;
    pendingExtensionAction = `add-instruction:${extension.id}`;
    inventoryError = null;
    try {
      extensionsInventory = await runtime.addExtensionInstructionFile({
        extensionId: extension.id,
        name,
      });
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to add instruction file.";
    } finally {
      pendingExtensionAction = null;
    }
  }

  async function removeInstructionFile(extensionId: string, name: string) {
    if (pendingExtensionAction) return;
    pendingExtensionAction = `remove-instruction:${extensionId}:${name}`;
    inventoryError = null;
    try {
      extensionsInventory = await runtime.removeExtensionInstructionFile({ extensionId, name });
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to remove instruction file.";
    } finally {
      pendingExtensionAction = null;
    }
  }

  async function setInstructionSkipped(extensionId: string, name: string, skipped: boolean) {
    if (pendingExtensionAction) return;
    pendingExtensionAction = `skip-instruction:${extensionId}:${name}`;
    inventoryError = null;
    try {
      extensionsInventory = await runtime.configureExtensionInstructionFile({
        extensionId,
        name,
        skipped,
      });
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to update instruction file.";
    } finally {
      pendingExtensionAction = null;
    }
  }

  async function setExtensionTypescriptApi(extension: ExtensionInventoryItemReadModel, enabled: boolean) {
    if (pendingExtensionAction || extension.interface !== "svvyx") return;
    pendingExtensionAction = `typescript-api:${extension.id}`;
    inventoryError = null;
    try {
      extensionsInventory = await runtime.setExtensionTypescriptApi({
        extensionId: extension.id,
        enabled,
      });
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to update TypeScript API setting.";
    } finally {
      pendingExtensionAction = null;
    }
  }

  function addExtensionDragListeners() {
    window.addEventListener("pointermove", handleExtensionDragMove);
    window.addEventListener("pointerup", handleExtensionDragEnd);
    window.addEventListener("pointercancel", handleExtensionDragCancel);
  }

  function removeExtensionDragListeners() {
    window.removeEventListener("pointermove", handleExtensionDragMove);
    window.removeEventListener("pointerup", handleExtensionDragEnd);
    window.removeEventListener("pointercancel", handleExtensionDragCancel);
  }

  function startExtensionDrag(event: PointerEvent, extension: ExtensionInventoryItemReadModel) {
    if (extensionFilter !== "all") return;
    extensionDrag = {
      extensionId: extension.id,
      pointerId: event.pointerId,
      startY: event.clientY,
      didMove: false,
    };
    draggedExtensionId = null;
    dropBeforeExtensionId = null;
    dragCaptureElement = event.currentTarget as HTMLElement;
    dragCaptureElement.setPointerCapture(event.pointerId);
    addExtensionDragListeners();
  }

  function extensionDropTarget(clientY: number): string | null {
    const candidates = [
      ...(extensionListElement?.querySelectorAll<HTMLElement>("[data-extension-draggable='true']") ??
        []),
    ].filter((element) => element.dataset.extensionId !== draggedExtensionId);
    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return element.dataset.extensionId ?? null;
    }
    return null;
  }

  function applyExtensionDragMove(clientY: number) {
    if (!extensionDrag) return;
    const didMove = extensionDrag.didMove || Math.abs(clientY - extensionDrag.startY) > 5;
    if (!didMove) return;
    if (!extensionDrag.didMove) draggedExtensionId = extensionDrag.extensionId;
    extensionDrag = { ...extensionDrag, didMove: true };
    dropBeforeExtensionId = extensionDropTarget(clientY);
  }

  function handleExtensionDragMove(event: PointerEvent) {
    if (!extensionDrag || event.pointerId !== extensionDrag.pointerId) return;
    applyExtensionDragMove(event.clientY);
    if (extensionDrag.didMove || Math.abs(event.clientY - extensionDrag.startY) > 5) {
      event.preventDefault();
    }
  }

  function handleExtensionDragCancel(event: PointerEvent) {
    if (!extensionDrag || event.pointerId !== extensionDrag.pointerId) return;
    cancelExtensionDrag();
  }

  function releaseExtensionDragCapture(pointerId: number) {
    if (dragCaptureElement?.hasPointerCapture(pointerId)) {
      dragCaptureElement.releasePointerCapture(pointerId);
    }
    dragCaptureElement = null;
  }

  function cancelExtensionDrag() {
    if (!extensionDrag) return;
    releaseExtensionDragCapture(extensionDrag.pointerId);
    removeExtensionDragListeners();
    extensionDrag = null;
    draggedExtensionId = null;
    dropBeforeExtensionId = null;
  }

  async function handleExtensionDragEnd(event: PointerEvent) {
    if (!extensionDrag || event.pointerId !== extensionDrag.pointerId) return;
    applyExtensionDragMove(event.clientY);
    const completedDrag = extensionDrag.didMove;
    const movingId = extensionDrag.extensionId;
    const beforeId = dropBeforeExtensionId;
    const pointerId = extensionDrag.pointerId;
    extensionDrag = null;
    draggedExtensionId = null;
    dropBeforeExtensionId = null;
    releaseExtensionDragCapture(pointerId);
    removeExtensionDragListeners();
    const rows = inventoryRows();
    if (!completedDrag || !queuedMessageOrderChanged(rows, movingId, beforeId)) return;
    try {
      extensionsInventory = await runtime.reorderExtensionDefaults({
        extensionIds: reorderQueuedMessageItems(rows, movingId, beforeId).map(
          (extension) => extension.id,
        ),
      });
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to reorder extensions.";
    }
  }

  async function focusTargetExtension(extensionId: string): Promise<void> {
    await tick();
    const row = extensionRowElements.get(extensionId);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function snapshotRows(): ExtensionSnapshotReadModel[] {
    return extensionsInventory?.snapshots ?? [];
  }

  function selectedSnapshot(): ExtensionSnapshotReadModel | null {
    return snapshotRows().find((snapshot) => snapshot.id === selectedSnapshotId) ?? null;
  }

  function snapshotOptions(): CompactComboboxOption[] {
    return snapshotRows().map((snapshot) => {
      const details = [
        `${snapshot.extensionCount} extension${snapshot.extensionCount === 1 ? "" : "s"}`,
        snapshot.hasSecretState ? "secret state" : null,
      ].filter(Boolean);
      return {
        value: snapshot.id,
        label: `${snapshot.name} · ${details.join(" · ")}`,
        triggerLabel: snapshot.name,
        searchText: `${snapshot.name} ${snapshot.id} ${details.join(" ")}`,
        disabled: snapshotAction !== null,
      };
    });
  }

  function usageFor(
    extension: ExtensionInventoryItemReadModel,
    actor: (typeof ACTORS)[number]["id"],
  ): string {
    const inventoryUsage = extension.usage.find((usage) => usage.actorKind === actor);
    if (inventoryUsage) return usageLabel(inventoryUsage.state);
    const state = actorStates.find((candidate) => candidate.id === actor)?.state;
    if (state?.loadedExtensionIds.includes(extension.id)) return "Loaded";
    if (state?.availableExtensionIds.includes(extension.id)) return "Available";
    return "Unavailable";
  }

  function usageLabel(state: string): string {
    if (state === "default_loaded") return "Loaded";
    if (state === "available") return "Available";
    return "Unavailable";
  }

  function usageTone(usage: string): "neutral" | "info" | "success" | "warning" | "danger" {
    if (usage === "Loaded") return "success";
    if (usage === "Available") return "info";
    return "neutral";
  }

  function interfaceLabel(kind: string): string {
    if (kind === "native_tool") return "Native";
    if (kind === "svvyx") return "svvyx";
    return "Prompt";
  }

  function categoryLabel(category: string): string {
    if (category === "external_instruction") return "External Instructions";
    if (category === "user") return "User";
    return "builtin";
  }

  function sourceGroupLabel(group: string): string {
    if (group === "builtin_global_root") return "builtin global root";
    if (group === "custom_global_root") return "Custom global root";
    return "Workspace chain";
  }

  function shortHash(hash: string): string {
    return hash ? hash.slice(0, 12) : "unreadable";
  }

  function inventoryCliRequirements(extensionId: string): ExtensionCliRequirementReadiness[] {
    return (
      extensionsInventory?.extensions.find((extension) => extension.id === extensionId)?.requirements
        .cliRequirements ?? []
    );
  }

  function inventoryEnvRequirements(extensionId: string): ExtensionEnvRequirementReadiness[] {
    return (
      extensionsInventory?.extensions.find((extension) => extension.id === extensionId)?.requirements
        .env ?? []
    );
  }

  function cliRequirementTone(
    requirement: ExtensionCliRequirementReadiness,
  ): "neutral" | "info" | "success" | "warning" | "danger" {
    if (requirement.status === "missing") return "danger";
    if (requirement.status === "unknown") return "warning";
    if (requirement.updateAvailable) return "info";
    return "success";
  }

  function cliRequirementLabel(requirement: ExtensionCliRequirementReadiness): string {
    if (requirement.status === "missing") return `${requirement.binary}: missing`;
    if (requirement.status === "unknown") return `${requirement.binary}: unknown`;
    if (requirement.updateAvailable) return `${requirement.binary}: update`;
    return `${requirement.binary}: available`;
  }

  function cliRequirementVersions(requirement: ExtensionCliRequirementReadiness): string {
    const parts: string[] = [];
    if (requirement.currentVersion) parts.push(`current ${requirement.currentVersion}`);
    if (!requirement.currentVersion && requirement.detectedVersion) {
      parts.push(`detected ${requirement.detectedVersion}`);
    }
    if (requirement.defaultVersion) parts.push(`default ${requirement.defaultVersion}`);
    if (requirement.latestVersion) parts.push(`latest ${requirement.latestVersion}`);
    return parts.join(" · ") || "version unavailable";
  }

  function cliRequirementCommand(requirement: ExtensionCliRequirementReadiness): string | null {
    if (requirement.status === "missing") return requirement.installCommand;
    if (requirement.updateAvailable) return requirement.updateCommand;
    return null;
  }

  function declaredCliRequirementBinaries(extensionId: string): string[] {
    return (
      BUILTIN_EXTENSIONS.find((extension) => extension.id === extensionId)?.cliRequirements?.map(
        (requirement) => requirement.binary,
      ) ?? []
    );
  }

  function envRequirementTone(
    requirement: ExtensionEnvRequirementReadiness,
  ): "neutral" | "info" | "success" | "warning" | "danger" {
    if (requirement.status === "configured" || requirement.status === "defaulted") {
      return "success";
    }
    if (requirement.status === "missing" && requirement.required) return "danger";
    return "neutral";
  }

  function envRequirementLabel(requirement: ExtensionEnvRequirementReadiness): string {
    if (requirement.status === "configured") return `${requirement.name}: configured`;
    if (requirement.status === "defaulted") return `${requirement.name}: default`;
    if (requirement.status === "missing") return `${requirement.name}: missing`;
    return `${requirement.name}: optional`;
  }

  async function saveExtensionEnvValue(
    extensionId: string,
    requirement: ExtensionEnvRequirementReadiness,
    value: string,
  ): Promise<void> {
    if (requirement.secret) {
      extensionsInventory = await runtime.setExtensionEnvSecret({
        extensionId,
        name: requirement.name,
        value,
      });
      return;
    }
    extensionsInventory = await runtime.setExtensionEnvOverride({
      extensionId,
      name: requirement.name,
      value,
    });
  }

  async function removeExtensionEnvValue(
    extensionId: string,
    requirement: ExtensionEnvRequirementReadiness,
  ): Promise<void> {
    if (requirement.secret) {
      extensionsInventory = await runtime.removeExtensionEnvSecret({
        extensionId,
        name: requirement.name,
      });
      return;
    }
    extensionsInventory = await runtime.removeExtensionEnvOverride({
      extensionId,
      name: requirement.name,
    });
  }

  async function loadSettings(): Promise<void> {
    try {
      settingsError = null;
      agentSettings = await runtime.getAgentSettings();
    } catch (error) {
      settingsError = error instanceof Error ? error.message : "Settings are unavailable.";
    }
  }

  async function loadAppPreferences(): Promise<void> {
    try {
      settingsError = null;
      appPreferences = await runtime.getAppPreferences();
    } catch (error) {
      settingsError = error instanceof Error ? error.message : "App preferences are unavailable.";
    }
  }

  async function loadExtensionsInventory(): Promise<void> {
    loadingInventory = !extensionsInventory;
    inventoryError = null;
    try {
      extensionsInventory = await runtime.getExtensionsInventory();
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Extension CLI readiness is unavailable.";
    } finally {
      loadingInventory = false;
    }
  }

  function syncRuntimeSnapshots(): void {
    const nextSettings = runtime.agentSettingsSnapshot;
    const nextPreferences = runtime.appPreferencesSnapshot;
    const nextInventory = runtime.extensionsInventorySnapshot;
    if (nextSettings) {
      agentSettings = nextSettings;
    }
    if (nextPreferences) {
      appPreferences = nextPreferences;
    }
    if (nextInventory) {
      extensionsInventory = nextInventory;
      loadingInventory = false;
    }
  }

  syncRuntimeSnapshots();

  async function loadContextPreview(): Promise<void> {
    loadingPreview = true;
    settingsError = null;
    try {
      contextPreview = await runtime.getAgentContextPreview({ actor: "orchestrator" });
    } catch (error) {
      settingsError =
        error instanceof Error ? error.message : "Generated context preview is unavailable.";
    } finally {
      loadingPreview = false;
    }
  }

  async function updateRequestUserInputSettings(
    patch: Partial<RequestUserInputSettings> & {
      blockingTimeout?: Partial<RequestUserInputSettings["blockingTimeout"]>;
    },
  ): Promise<void> {
    if (!agentSettings || pendingSettings) return;
    const current = agentSettings.requestUserInput;
    const next: RequestUserInputSettings = {
      mode: patch.mode ?? current.mode,
      blockingTimeout: {
        enabled: patch.blockingTimeout?.enabled ?? current.blockingTimeout.enabled,
        durationMs: patch.blockingTimeout?.durationMs ?? current.blockingTimeout.durationMs,
      },
    };
    pendingSettings = true;
    settingsError = null;
    try {
      agentSettings = await runtime.updateRequestUserInputSettings(next);
    } catch (error) {
      settingsError = error instanceof Error ? error.message : "Unable to save settings.";
    } finally {
      pendingSettings = false;
    }
  }

  function updateBlockingTimeoutSeconds(value: string): void {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return;
    void updateRequestUserInputSettings({
      blockingTimeout: { durationMs: Math.max(1, Math.floor(seconds)) * 1000 },
    });
  }

  function defaultSnapshotName(date = new Date()): string {
    return `Snapshot ${new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)}`;
  }

  function closeSnapshotControls(): void {
    snapshotPopoverOpen = false;
    renamingSnapshotId = null;
    confirmingDeleteSnapshotId = null;
  }

  async function openSnapshotPopover(): Promise<void> {
    snapshotName = defaultSnapshotName();
    snapshotPopoverOpen = true;
    renamingSnapshotId = null;
    confirmingDeleteSnapshotId = null;
    await tick();
    snapshotNameInput?.focus();
    snapshotNameInput?.select();
  }

  async function saveExtensionSnapshot(): Promise<void> {
    const name = snapshotName.trim();
    if (!name || snapshotAction) return;
    snapshotAction = "save";
    inventoryError = null;
    try {
      extensionsInventory = await runtime.saveExtensionSnapshot(name);
      const created = snapshotRows().find((snapshot) => snapshot.name === name);
      selectedSnapshotId = created?.id ?? selectedSnapshotId;
      snapshotPopoverOpen = false;
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Unable to save extension snapshot.";
    } finally {
      snapshotAction = null;
    }
  }

  async function loadExtensionSnapshot(snapshotId: string): Promise<void> {
    if (!snapshotId || snapshotAction) return;
    selectedSnapshotId = snapshotId;
    snapshotAction = "load";
    inventoryError = null;
    try {
      extensionsInventory = await runtime.loadExtensionSnapshot(snapshotId);
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Unable to load extension snapshot.";
    } finally {
      snapshotAction = null;
    }
  }

  async function startRenameSnapshot(): Promise<void> {
    const snapshot = selectedSnapshot();
    if (!snapshot || snapshotAction) return;
    renamingSnapshotId = snapshot.id;
    renameSnapshotName = snapshot.name;
    snapshotPopoverOpen = false;
    confirmingDeleteSnapshotId = null;
    await tick();
    renameSnapshotInput?.focus();
    renameSnapshotInput?.select();
  }

  async function renameExtensionSnapshot(): Promise<void> {
    const snapshotId = renamingSnapshotId;
    const name = renameSnapshotName.trim();
    if (!snapshotId || !name || snapshotAction) return;
    snapshotAction = "rename";
    inventoryError = null;
    try {
      extensionsInventory = await runtime.renameExtensionSnapshot(snapshotId, name);
      selectedSnapshotId = snapshotId;
      renamingSnapshotId = null;
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to rename extension snapshot.";
    } finally {
      snapshotAction = null;
    }
  }

  function requestDeleteSnapshot(): void {
    const snapshot = selectedSnapshot();
    if (!snapshot || snapshotAction) return;
    confirmingDeleteSnapshotId = snapshot.id;
    snapshotPopoverOpen = false;
    renamingSnapshotId = null;
  }

  async function deleteExtensionSnapshot(): Promise<void> {
    const snapshotId = confirmingDeleteSnapshotId;
    if (!snapshotId || snapshotAction) return;
    snapshotAction = "delete";
    inventoryError = null;
    try {
      extensionsInventory = await runtime.deleteExtensionSnapshot(snapshotId);
      if (selectedSnapshotId === snapshotId) selectedSnapshotId = "";
      confirmingDeleteSnapshotId = null;
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to delete extension snapshot.";
    } finally {
      snapshotAction = null;
    }
  }

  async function openExternalInstruction(path: string): Promise<void> {
    inventoryError = null;
    try {
      await runtime.openGeneratedAgentContextExternalSourceInEditor(path);
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to open external instruction source.";
    }
  }

  function copyAppPreferences(input: AppPreferences): AppPreferences {
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
          Object.entries(input.ambientAgentResources.categories).map(([category, setting]) => [
            category,
            { enabled: setting.enabled },
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

  function actorLabel(actor: ExternalInstructionActor): string {
    return ACTORS.find((candidate) => candidate.id === actor)?.label ?? actor;
  }

  function externalInstructionControl(
    extension: ExtensionInventoryItemReadModel,
  ): ExternalInstructionControl {
    return {
      enabled: extension.externalInstruction?.enabled === true,
      actors: [...(extension.externalInstruction?.actors ?? [])],
    };
  }

  async function saveExternalInstructionControl(
    extension: ExtensionInventoryItemReadModel,
    control: ExternalInstructionControl,
  ): Promise<void> {
    if (!extension.externalInstruction || !appPreferences || pendingExternalInstructionPath) return;
    const source = extension.externalInstruction;
    const nextPreferences = copyAppPreferences(appPreferences);
    const nextControl: ExternalInstructionControl = {
      enabled: control.enabled,
      actors: control.actors.filter((actor) =>
        DEFAULT_EXTERNAL_INSTRUCTION_ACTORS.includes(actor),
      ),
    };
    pendingExternalInstructionPath = source.path;
    inventoryError = null;
    try {
      if (source.sourceGroup === "workspace_chain") {
        nextPreferences.externalInstructions.workspaceControls = {
          ...nextPreferences.externalInstructions.workspaceControls,
          [runtime.workspaceId]: {
            ...nextPreferences.externalInstructions.workspaceControls[runtime.workspaceId],
            [source.path]: nextControl,
          },
        };
      } else {
        nextPreferences.externalInstructions.globalControls = {
          ...nextPreferences.externalInstructions.globalControls,
          [source.path]: nextControl,
        };
      }
      appPreferences = await runtime.updateAppPreferences(nextPreferences);
      extensionsInventory = await runtime.getExtensionsInventory();
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to save external instruction controls.";
    } finally {
      pendingExternalInstructionPath = null;
    }
  }

  function setExternalInstructionEnabled(
    extension: ExtensionInventoryItemReadModel,
    enabled: boolean,
  ): void {
    void saveExternalInstructionControl(extension, {
      ...externalInstructionControl(extension),
      enabled,
    });
  }

  function setExternalInstructionActor(
    extension: ExtensionInventoryItemReadModel,
    actor: ExternalInstructionActor,
    enabled: boolean,
  ): void {
    const control = externalInstructionControl(extension);
    const actors = new Set(control.actors);
    if (enabled) {
      actors.add(actor);
    } else {
      actors.delete(actor);
    }
    void saveExternalInstructionControl(extension, {
      ...control,
      actors: [...actors],
    });
  }

  onMount(() => {
    const unsubscribeRuntime = runtime.subscribe(syncRuntimeSnapshots);
    void loadSettings();
    void loadAppPreferences();
    void loadExtensionsInventory();
    return unsubscribeRuntime;
  });

  $effect(() => {
    if (targetView === "generated-context-preview" && !contextPreview && !loadingPreview) {
      void loadContextPreview();
    }
  });

  $effect(() => {
    if (targetView !== "inventory" || !targetExtensionId || loadingInventory) return;
    const rowCount = inventoryRows().length;
    if (rowCount === 0) return;
    void focusTargetExtension(targetExtensionId);
  });

  $effect(() => {
    const snapshots = snapshotRows();
    if (selectedSnapshotId && !snapshots.some((snapshot) => snapshot.id === selectedSnapshotId)) {
      selectedSnapshotId = "";
    }
  });
</script>

<section class="extensions-pane" aria-label="Extensions">
  {#if targetView === "generated-context-preview"}
    <section class="generated-context-preview" aria-label="Generated context preview">
      {#if settingsError}
        <p class="extension-settings-error" role="alert">{settingsError}</p>
      {/if}
      {#if loadingPreview && !contextPreview}
        <p class="extension-settings-loading">Loading generated context preview</p>
      {:else if contextPreview}
        <div class="generated-context-preview-meta">
          <div>
            <p>Generated Context Preview</p>
            <h3>{contextPreview.profileName}</h3>
          </div>
          <span>{contextPreview.provider}/{contextPreview.model} · {contextPreview.reasoningEffort}</span>
        </div>
        <div class="generated-context-preview-tags">
          <span>Loaded: {contextPreview.loadedExtensionIds.join(", ") || "none"}</span>
          <span>Available: {contextPreview.availableExtensionIds.join(", ") || "none"}</span>
        </div>
        <pre>{contextPreview.systemPrompt}</pre>
      {/if}
    </section>
  {:else}
  <div class="extensions-inventory">
    <section class="extension-toolbar" aria-label="Extension controls">
      <div class="extension-toolbar-row extension-toolbar-history-row">
        <Tooltip label="Reset default extension order">
          <button
            type="button"
            class="extension-toolbar-action"
            disabled={pendingExtensionAction !== null}
            onclick={async () => {
              pendingExtensionAction = "reset-order";
              try {
                extensionsInventory = await runtime.reorderExtensionDefaults({ extensionIds: [] });
              } finally {
                pendingExtensionAction = null;
              }
            }}
          >
            <RotateCcwIcon aria-hidden="true" size={12} strokeWidth={1.9} />
            Order
          </button>
        </Tooltip>
        <div class="extension-toolbar-spacer" aria-hidden="true"></div>
        <div
          class="extension-snapshot-controls"
          use:dismissConfirmation={{
            active:
              snapshotPopoverOpen ||
              renamingSnapshotId !== null ||
              confirmingDeleteSnapshotId !== null,
            onDismiss: closeSnapshotControls,
          }}
        >
          <CompactCombobox
            value={selectedSnapshotId}
            options={snapshotOptions()}
            ariaLabel="Load extension snapshot"
            placeholder="Snapshots"
            emptyLabel="No snapshots saved."
            triggerClass="snapshot-trigger"
            menuClass="snapshot-menu"
            optionClass="snapshot-option"
            placement="below"
            disabled={snapshotAction !== null || snapshotRows().length === 0}
            onSelect={(snapshotId) => loadExtensionSnapshot(snapshotId)}
          />
          <Tooltip label="Save current extension state">
            <Button
              class="snapshot-icon-button"
              variant="ghost"
              size="xs"
              iconOnly
              disabled={snapshotAction !== null}
              aria-label="Save extension snapshot"
              onclick={() => void openSnapshotPopover()}
            >
              <SaveIcon aria-hidden="true" size={13} strokeWidth={1.9} />
            </Button>
          </Tooltip>
          <Tooltip
            label={selectedSnapshot() ? "Rename selected extension snapshot" : "Select a snapshot to rename"}
            disabled={snapshotAction !== null}
          >
            <Button
              class="snapshot-icon-button"
              variant="ghost"
              size="xs"
              iconOnly
              disabled={!selectedSnapshot() || snapshotAction !== null}
              aria-label="Rename selected extension snapshot"
              onclick={() => void startRenameSnapshot()}
            >
              <PencilIcon aria-hidden="true" size={13} strokeWidth={1.9} />
            </Button>
          </Tooltip>
          <Tooltip
            label={
              confirmingDeleteSnapshotId
                ? "Confirm delete"
                : selectedSnapshot()
                  ? "Delete selected extension snapshot"
                  : "Select a snapshot to delete"
            }
            disabled={snapshotAction !== null}
          >
            <Button
              class={`snapshot-icon-button ${confirmingDeleteSnapshotId ? "confirming-delete" : ""}`.trim()}
              variant={confirmingDeleteSnapshotId ? "danger" : "ghost"}
              size="xs"
              iconOnly
              disabled={!selectedSnapshot() || snapshotAction !== null}
              aria-label={
                confirmingDeleteSnapshotId
                  ? "Confirm deleting selected extension snapshot"
                  : "Delete selected extension snapshot"
              }
              onclick={() =>
                confirmingDeleteSnapshotId
                  ? void deleteExtensionSnapshot()
                  : requestDeleteSnapshot()}
            >
              {#if confirmingDeleteSnapshotId}
                <CheckIcon aria-hidden="true" size={13} strokeWidth={2.1} />
              {:else}
                <Trash2Icon aria-hidden="true" size={13} strokeWidth={1.9} />
              {/if}
            </Button>
          </Tooltip>

        {#if snapshotPopoverOpen}
          <div class="snapshot-popover" role="dialog" aria-label="Save extension snapshot">
            <input
              bind:this={snapshotNameInput}
              class="snapshot-name-input"
              bind:value={snapshotName}
              aria-label="Snapshot name"
              onkeydown={(event) => {
                if (event.key === "Enter") void saveExtensionSnapshot();
                if (event.key === "Escape") closeSnapshotControls();
              }}
            />
            <Tooltip label="Save extension snapshot">
              <Button
                class="snapshot-icon-button"
                variant="ghost"
                size="xs"
                iconOnly
                disabled={snapshotAction !== null || !snapshotName.trim()}
                aria-label="Save snapshot"
                onclick={() => void saveExtensionSnapshot()}
              >
                <CheckIcon aria-hidden="true" size={13} strokeWidth={2.1} />
              </Button>
            </Tooltip>
          </div>
        {/if}

        {#if renamingSnapshotId}
          <div class="snapshot-popover" role="dialog" aria-label="Rename extension snapshot">
            <input
              bind:this={renameSnapshotInput}
              class="snapshot-name-input"
              bind:value={renameSnapshotName}
              aria-label="Snapshot name"
              onkeydown={(event) => {
                if (event.key === "Enter") void renameExtensionSnapshot();
                if (event.key === "Escape") closeSnapshotControls();
              }}
            />
            <Tooltip label="Rename extension snapshot">
              <Button
                class="snapshot-icon-button"
                variant="ghost"
                size="xs"
                iconOnly
                disabled={snapshotAction !== null || !renameSnapshotName.trim()}
                aria-label="Rename snapshot"
                onclick={() => void renameExtensionSnapshot()}
              >
                <CheckIcon aria-hidden="true" size={13} strokeWidth={2.1} />
              </Button>
            </Tooltip>
          </div>
        {/if}
        </div>
      </div>
      <div class="extension-toolbar-row extension-toolbar-action-row">
        <div class="extension-filter-group" aria-label="Filter extensions">
          {#each FILTERS as filter (filter.id)}
            <button
              type="button"
              class={`extension-filter ${extensionFilter === filter.id ? "active" : ""}`.trim()}
              aria-pressed={extensionFilter === filter.id}
              onclick={() => (extensionFilter = filter.id)}
            >
              {filter.label}
            </button>
          {/each}
        </div>
        <div class="extension-toolbar-actions">
          <Button
            class="new-extension-button"
            variant="ghost"
            size="xs"
            disabled={pendingExtensionAction !== null}
            onclick={() => (newExtensionOpen = !newExtensionOpen)}
          >
            <PlusIcon aria-hidden="true" size={13} strokeWidth={2} />
            <span>New</span>
          </Button>
        </div>
      </div>
    </section>

    {#if inventoryError}
      <p class="extension-settings-error" role="alert">{inventoryError}</p>
    {/if}

    {#if newExtensionOpen}
      <section class="new-extension-popover" aria-label="New extension">
        <input
          class="snapshot-name-input"
          bind:value={newExtensionTitle}
          placeholder="Extension name"
          aria-label="Extension name"
          onkeydown={(event) => {
            if (event.key === "Enter") void createExtension();
            if (event.key === "Escape") newExtensionOpen = false;
          }}
        />
        <input
          class="snapshot-name-input"
          bind:value={newExtensionDescription}
          placeholder="Description"
          aria-label="Extension description"
          onkeydown={(event) => {
            if (event.key === "Enter") void createExtension();
            if (event.key === "Escape") newExtensionOpen = false;
          }}
        />
        <Button
          size="xs"
          variant="primary"
          disabled={!newExtensionTitle.trim() || pendingExtensionAction !== null}
          onclick={() => void createExtension()}
        >
          Create
        </Button>
      </section>
    {/if}

  <div class="extensions-list" aria-label="Extension inventory" bind:this={extensionListElement}>
    {#each inventoryRows() as extension (extension.id)}
      {@const cliRequirements = inventoryCliRequirements(extension.id)}
      {@const envRequirements = inventoryEnvRequirements(extension.id)}
      {@const declaredCliBinaries = declaredCliRequirementBinaries(extension.id)}
      {@const expanded = expandedExtensionIds.has(extension.id)}
      {@const tokenCount = extensionTokenCount(extension)}
      <div
        use:registerExtensionRow={extension.id}
        data-extension-id={extension.id}
        data-extension-draggable={extensionFilter === "all" ? "true" : "false"}
        animate:flip={{ duration: draggedExtensionId ? 150 : 0 }}
      >
        <ExtensionListRow
          id={extension.id}
          title={extension.title}
          description={extension.description}
          markerLabel="customized"
          markerVisible={customizedExtension(extension)}
          dragging={extension.id === draggedExtensionId}
          draggable={extensionFilter === "all"}
          dragLabel={`Reorder ${extension.title}`}
          expanded={expanded}
          expandedInset={false}
          target={extension.id === targetExtensionId}
          onDragPointerDown={(event) => startExtensionDrag(event, extension)}
          onToggle={() => toggleExtensionExpanded(extension.id)}
        >
          {#snippet leading()}
            <Tooltip label={extensionKindTooltip(extension.interface)}>
              <span class={`extension-kind-icon ${extension.interface}`.trim()} aria-label={extensionKindTitle(extension.interface)}>
                {#if extension.interface === "svvyx"}
                  <TerminalIcon size={14} aria-hidden="true" />
                {:else if extension.interface === "native_tool"}
                  <Code2Icon size={14} aria-hidden="true" />
                {:else}
                  <FileTextIcon size={14} aria-hidden="true" />
                {/if}
              </span>
            </Tooltip>
          {/snippet}
          {#snippet meta()}
            <Badge tone={extension.category === "external_instruction" ? "info" : "neutral"}>
              {categoryLabel(extension.category)}
            </Badge>
            {#if generatedApiLabel(extension)}
              <Badge tone="info">{generatedApiLabel(extension)}</Badge>
            {/if}
            {#if !extension.state.ready}
              <Badge tone="warning">{extension.state.issues[0]?.code ?? "issue"}</Badge>
            {/if}
          {/snippet}
          {#snippet actions()}
            <Tooltip label={extension.interface === "native_tool" ? "Native tool extensions cannot be duplicated" : "Duplicate extension"}>
              <button
                type="button"
                class="extension-icon-action"
                disabled={extension.interface === "native_tool" || pendingExtensionAction !== null}
                aria-label={`Duplicate ${extension.title}`}
                onclick={() => duplicateExtension(extension)}
              >
                <CopyPlusIcon size={13} aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label={extension.category === "builtin" ? "Reset builtin extension" : "Only builtin extensions can be reset"}>
              <button
                type="button"
                class="extension-icon-action"
                disabled={extension.category !== "builtin" || pendingExtensionAction !== null}
                aria-label={`Reset ${extension.title}`}
                onclick={() => resetExtension(extension)}
              >
                <RotateCcwIcon size={13} aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label={extension.category === "builtin" ? "builtin extensions cannot be deleted" : "Delete extension"}>
              <button
                type="button"
                class="extension-icon-action danger"
                disabled={extension.category === "builtin" || pendingExtensionAction !== null}
                aria-label={`Delete ${extension.title}`}
                onclick={() => deleteExtension(extension)}
              >
                <Trash2Icon size={13} aria-hidden="true" />
              </button>
            </Tooltip>
          {/snippet}
          {#snippet expandedContent()}
          <section class="extension-defaults-section" aria-label={`${extension.title} defaults`}>
            <div class="extension-expanded-section-header">
              <strong>Defaults</strong>
              <span>{formatPromptTokenCount(tokenCount)}</span>
            </div>
            <div class="extension-default-controls">
              {#if extension.interface === "svvyx"}
                <label class="extension-default-control extension-typescript-api-control">
                  <span>TypeScript API</span>
                  <Checkbox
                    size="sm"
                    checked={extension.typescriptApiEnabled}
                    disabled={pendingExtensionAction !== null}
                    onchange={(event) =>
                      setExtensionTypescriptApi(
                        extension,
                        (event.currentTarget as HTMLInputElement).checked,
                      )}
                  />
                </label>
              {/if}
              {#each DEFAULT_ACTORS as actor (actor.id)}
                {@const usage = defaultUsageFor(extension, actor.id)}
                <div class="extension-default-control" aria-label={`${extension.title} ${actor.label} default`}>
                  <span>{actor.label}</span>
                  <div>
                    <ExtensionStateButtons
                      ariaLabel={`${extension.title} ${actor.label} default`}
                      selected={usage.state}
                      disabled={!usage.configurable || pendingDefaultUsageKey !== null}
                      labelFor={(state) => USAGE_STATES.find((entry) => entry.state === state)?.label ?? "Off"}
                      onSelect={(state) => setDefaultUsage(extension, actor.id, state)}
                    />
                  </div>
                </div>
              {/each}
            </div>
          </section>
          {#if extension.externalInstruction}
            <div class="external-instruction-readonly" aria-label={`${extension.title} external instruction source`}>
              <div class="external-instruction-meta">
                <Badge tone={extension.externalInstruction.readStatus.status === "readable" ? "success" : "danger"}>
                  {extension.externalInstruction.readStatus.status}
                </Badge>
                <span>{sourceGroupLabel(extension.externalInstruction.sourceGroup)}</span>
                <span>order {extension.externalInstruction.order}</span>
                <span>sha {shortHash(extension.externalInstruction.contentHash)}</span>
              </div>
              <code>{extension.externalInstruction.path}</code>
              {#if extension.externalInstruction.readStatus.status === "unreadable"}
                <span class="extension-cli-error">{extension.externalInstruction.readStatus.error ?? "Unable to read file."}</span>
              {:else}
                <pre>{extension.externalInstruction.content}</pre>
              {/if}
            </div>
          {/if}
          {#if extension.minimalInstruction}
            <div class="extension-minimal-instruction">
              <div class="extension-instruction-list-header">
                <strong>Minimal instruction</strong>
              </div>
              <ExtensionInstructionFileEditor
                runtime={runtime}
                extensionId={extension.id}
                kind="minimal"
                file={extension.minimalInstruction}
                label="source"
                editor={appPreferences?.preferredExternalEditor}
                disabled={pendingExtensionAction !== null}
                onSaved={() => void loadExtensionsInventory()}
              />
            </div>
          {/if}
          {#if cliRequirements.length}
            <div class="extension-cli-requirements" aria-label={`${extension.title} CLI readiness`}>
              {#each cliRequirements as requirement (requirement.id)}
                {@const command = cliRequirementCommand(requirement)}
                <div class="extension-cli-requirement">
                  <Badge tone={cliRequirementTone(requirement)}>
                    {cliRequirementLabel(requirement)}
                  </Badge>
                  <span>{cliRequirementVersions(requirement)}</span>
                  {#if command}
                    <code>{command}</code>
                  {/if}
                </div>
              {/each}
            </div>
          {:else if declaredCliBinaries.length && loadingInventory}
            <span class="extension-cli-loading">
              Checking {declaredCliBinaries.join(", ")}
            </span>
          {:else if declaredCliBinaries.length && inventoryError}
            <span class="extension-cli-error">{inventoryError}</span>
          {/if}
          {#if extension.loadedInstructionContributors.length}
            <div class="extension-instruction-list">
              <div class="extension-instruction-list-header">
                <strong>Loaded instructions</strong>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={pendingExtensionAction !== null || extension.category === "external_instruction"}
                  onclick={() => addInstructionFile(extension)}
                >
                  <PlusIcon size={13} aria-hidden="true" />
                  Add
                </Button>
              </div>
              {#each extension.loadedInstructionContributors as contributor (contributor.kind === "source" ? contributor.file.name : contributor.name)}
                <div class="extension-instruction-row">
                  <div class="extension-instruction-row-actions">
                    <Tooltip label={contributorSkipped(contributor) ? "Include in context" : "Skip without deleting it"}>
                      <button
                        type="button"
                        class="extension-icon-action"
                        disabled={pendingExtensionAction !== null}
                        aria-label={contributorSkipped(contributor) ? "Include contributor" : "Skip contributor"}
                        onclick={() =>
                          setInstructionSkipped(
                            extension.id,
                            contributor.kind === "source" ? contributor.file.name : contributor.output.name,
                            !contributorSkipped(contributor),
                          )}
                      >
                        <BanIcon size={13} aria-hidden="true" />
                      </button>
                    </Tooltip>
                    <Tooltip label={contributor.kind !== "source" || !contributor.file.editable ? "Only source instruction files can be removed" : "Remove file to app-managed trash"}>
                      <button
                        type="button"
                        class="extension-icon-action danger"
                        disabled={pendingExtensionAction !== null || contributor.kind !== "source" || !contributor.file.editable}
                        aria-label="Remove instruction contributor"
                        onclick={() =>
                          contributor.kind === "source"
                            ? removeInstructionFile(extension.id, contributor.file.name)
                            : undefined}
                      >
                        <Trash2Icon size={13} aria-hidden="true" />
                      </button>
                    </Tooltip>
                  </div>
                  {#if contributor.kind === "source"}
                    <ExtensionInstructionFileEditor
                      runtime={runtime}
                      extensionId={extension.id}
                      file={contributor.file}
                      label="source"
                      editor={appPreferences?.preferredExternalEditor}
                      disabled={pendingExtensionAction !== null}
                      onSaved={() => void loadExtensionsInventory()}
                    />
                  {:else}
                    <div class="scripted-instruction-contributor">
                      <div class="extension-instruction-list-header">
                        <strong>{contributor.name}</strong>
                        <Tooltip label={`Run ${contributor.regenerateCommand}`}>
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={pendingExtensionAction !== null}
                            onclick={() => void buildExtension(extension.id)}
                          >
                            <RotateCcwIcon size={13} aria-hidden="true" />
                            Build
                          </Button>
                        </Tooltip>
                      </div>
                      <ExtensionInstructionFileEditor
                        runtime={runtime}
                        extensionId={extension.id}
                        kind="script"
                        file={contributor.script}
                        label="generator"
                        showTokenCount={false}
                        editor={appPreferences?.preferredExternalEditor}
                        disabled={pendingExtensionAction !== null}
                        onSaved={() => void loadExtensionsInventory()}
                      />
                      <ExtensionInstructionFileEditor
                        runtime={runtime}
                        extensionId={extension.id}
                        file={contributor.output}
                        label="last generated"
                        editor={appPreferences?.preferredExternalEditor}
                        disabled={pendingExtensionAction !== null}
                        onSaved={() => void loadExtensionsInventory()}
                      />
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <Button
              size="xs"
              variant="ghost"
              disabled={pendingExtensionAction !== null || extension.category === "external_instruction"}
              onclick={() => addInstructionFile(extension)}
            >
              <PlusIcon size={13} aria-hidden="true" />
              Add instruction file
            </Button>
          {/if}
          {#if extension.tooling.nativeToolSchema || extension.tooling.svvyxCommandSource || extension.tooling.svvyxCommandSchema || extension.tooling.typescriptApiStatus !== "disabled"}
            <div class="extension-tooling-section" aria-label={`${extension.title} tooling`}>
              <div class="extension-instruction-list-header">
                <strong>Tooling</strong>
              </div>
              {#if extension.tooling.nativeToolSchema}
                <div class="extension-readonly-block">
                  <div class="extension-readonly-block-bar">
                    <strong>{extension.tooling.nativeToolSchema.name}</strong>
                    <span>native tool schema</span>
                  </div>
                  <pre>{extension.tooling.nativeToolSchema.content}</pre>
                </div>
              {/if}
              {#if extension.tooling.svvyxCommandSource}
                <ExtensionInstructionFileEditor
                  runtime={runtime}
                  extensionId={extension.id}
                  file={extension.tooling.svvyxCommandSource}
                  label="command source"
                  showTokenCount={false}
                  editor={appPreferences?.preferredExternalEditor}
                  disabled={pendingExtensionAction !== null}
                  onSaved={() => void loadExtensionsInventory()}
                />
              {/if}
              {#if extension.tooling.svvyxCommandSchema}
                <div class="extension-readonly-block">
                  <div class="extension-readonly-block-bar">
                    <strong>{extension.tooling.svvyxCommandSchema.name}</strong>
                    <span>generated command schema</span>
                  </div>
                  <pre>{extension.tooling.svvyxCommandSchema.content}</pre>
                </div>
              {/if}
              {#if extension.tooling.typescriptApiDeclaration}
                <div class="extension-readonly-block">
                  <div class="extension-readonly-block-bar">
                    <strong>{extension.tooling.typescriptApiDeclaration.name}</strong>
                    <span>generated TypeScript API</span>
                  </div>
                  <pre>{extension.tooling.typescriptApiDeclaration.content}</pre>
                </div>
              {:else if extension.tooling.typescriptApiStatus === "not_emitted"}
                <div class="extension-readonly-block">
                  <div class="extension-readonly-block-bar">
                    <strong>TypeScript API</strong>
                    <span>enabled, not emitted</span>
                  </div>
                  <pre>Generated TypeScript API declarations are not emitted for this extension in the current runtime.</pre>
                </div>
              {/if}
            </div>
          {/if}
          {#if envRequirements.length}
            <div class="extension-env-requirements" aria-label={`${extension.title} env readiness`}>
              {#each envRequirements as requirement (requirement.name)}
                <div class="extension-env-requirement">
                  <div class="extension-env-requirement-meta">
                    <Badge tone={envRequirementTone(requirement)}>
                      {envRequirementLabel(requirement)}
                    </Badge>
                    <span>{requirement.secret ? "Secret" : "Value"} · {requirement.description}</span>
                  </div>
                  <ExtensionEnvValueForm
                    secret={requirement.secret}
                    configured={requirement.status === "configured"}
                    onSave={(value) => saveExtensionEnvValue(extension.id, requirement, value)}
                    onRemove={
                      requirement.status === "configured"
                        ? () => removeExtensionEnvValue(extension.id, requirement)
                        : undefined
                    }
                  />
                </div>
              {/each}
            </div>
          {/if}
          {#if extension.externalInstruction || extension.id === "request-user-input"}
          <div class="extension-settings">
            {#if extension.externalInstruction}
            {@const control = externalInstructionControl(extension)}
            {@const isSavingExternalInstruction = pendingExternalInstructionPath === extension.externalInstruction.path}
            <div class="external-instruction-controls" aria-label={`${extension.title} usage controls`}>
              <label class="external-instruction-enable">
                <Checkbox
                  size="sm"
                  checked={control.enabled}
                  disabled={!appPreferences || isSavingExternalInstruction}
                  onchange={(event) =>
                    setExternalInstructionEnabled(
                      extension,
                      (event.currentTarget as HTMLInputElement).checked,
                    )}
                />
                <span>Enabled</span>
              </label>
              <div class="external-instruction-actors" aria-label={`${extension.title} actors`}>
                {#each ACTORS as actor (actor.id)}
                  <label class="external-instruction-actor">
                    <Checkbox
                      size="sm"
                      checked={control.actors.includes(actor.id)}
                      disabled={!appPreferences || isSavingExternalInstruction}
                      onchange={(event) =>
                        setExternalInstructionActor(
                          extension,
                          actor.id,
                          (event.currentTarget as HTMLInputElement).checked,
                        )}
                    />
                    <span>{actorLabel(actor.id)}</span>
                  </label>
                {/each}
              </div>
              <OpenExternalButton
                disabled={isSavingExternalInstruction}
                editor={appPreferences?.preferredExternalEditor}
                targetLabel={extension.externalInstruction.path}
                onclick={() => openExternalInstruction(extension.externalInstruction!.path)}
              />
            </div>
            {:else if extension.id === "request-user-input"}
            {#if settingsError}
              <p class="extension-settings-error" role="alert">{settingsError}</p>
            {/if}
            {#if agentSettings}
              <div class="request-input-mode" aria-label="Request User Input mode">
                <Button
                  size="xs"
                  variant={agentSettings.requestUserInput.mode === "nonblocking" ? "primary" : "ghost"}
                  disabled={pendingSettings}
                  onclick={() => updateRequestUserInputSettings({ mode: "nonblocking" })}
                >
                  Nonblocking
                </Button>
                <Button
                  size="xs"
                  variant={agentSettings.requestUserInput.mode === "blocking" ? "primary" : "ghost"}
                  disabled={pendingSettings}
                  onclick={() => updateRequestUserInputSettings({ mode: "blocking" })}
                >
                  Blocking
                </Button>
              </div>
              {#if agentSettings.requestUserInput.mode === "blocking"}
                <label class="request-input-timeout-toggle">
                  <Checkbox
                    size="sm"
                    checked={agentSettings.requestUserInput.blockingTimeout.enabled}
                    disabled={pendingSettings}
                    onchange={(event) =>
                      updateRequestUserInputSettings({
                        blockingTimeout: {
                          enabled: (event.currentTarget as HTMLInputElement).checked,
                        },
                      })}
                  />
                  <span>Timeout</span>
                </label>
                <label class="request-input-timeout-field">
                  <span>Seconds</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    disabled={pendingSettings || !agentSettings.requestUserInput.blockingTimeout.enabled}
                    value={Math.round(agentSettings.requestUserInput.blockingTimeout.durationMs / 1000)}
                    onchange={(event) =>
                      updateBlockingTimeoutSeconds((event.currentTarget as HTMLInputElement).value)}
                  />
                </label>
              {/if}
            {:else}
              <span class="extension-settings-loading">Loading</span>
            {/if}
            {/if}
          </div>
          {/if}
          {/snippet}
        </ExtensionListRow>
      </div>
    {/each}
  </div>
  </div>
  {/if}
</section>

<style>
  .extensions-pane {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    color: var(--ui-text-primary);
    background: var(--ui-surface);
  }

  .extensions-table {
    min-height: 0;
    overflow: auto;
  }

  .extensions-inventory {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    min-height: 0;
    overflow: auto;
  }

  .extension-toolbar {
    display: grid;
    gap: 0.32rem;
    padding: 0.42rem 1.1rem 0.48rem;
    border-bottom: 1px solid var(--ui-border-subtle);
    background: color-mix(in oklab, var(--ui-surface-subtle) 42%, transparent);
  }

  .extension-toolbar-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }

  .extension-toolbar-action-row {
    justify-content: space-between;
  }

  .extension-toolbar-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.34rem;
    min-width: 0;
  }

  .extension-toolbar-spacer {
    flex: 1 1 auto;
    min-width: 0.5rem;
  }

  .extension-toolbar-action {
    display: inline-flex;
    align-items: center;
    gap: 0.24rem;
    height: 1.42rem;
    padding: 0 0.42rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface-subtle);
    color: var(--ui-text-secondary);
    cursor: pointer;
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .extension-toolbar-action:hover:not(:disabled),
  .extension-toolbar-action:focus-visible:not(:disabled) {
    outline: none;
    border-color: var(--ui-border-strong);
    background: var(--ui-hover-bg);
    color: var(--ui-text-primary);
  }

  .extension-toolbar-action:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  .extension-toolbar-action:disabled {
    cursor: default;
    opacity: 0.58;
  }

  .extension-snapshot-controls {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.18rem;
    flex: 0 1 auto;
    min-width: 0;
  }

  :global(.snapshot-trigger) {
    justify-content: space-between;
    width: 18rem;
    min-height: 1.55rem;
    padding: 0.12rem 0.26rem 0.12rem 0.42rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-muted) 34%, transparent);
    color: var(--ui-text-secondary);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1;
  }

  :global(.snapshot-trigger:hover:not(:disabled)),
  :global(.snapshot-trigger:focus-visible) {
    outline: none;
    background: color-mix(in oklab, var(--ui-surface-muted) 52%, transparent);
    color: var(--ui-text-primary);
  }

  :global(.snapshot-trigger:focus-visible) {
    box-shadow: var(--ui-focus-ring);
  }

  :global(.snapshot-trigger:disabled) {
    cursor: default;
    opacity: 0.65;
  }

  :global(.snapshot-menu) {
    min-width: 30rem;
    width: max-content;
    max-width: min(54rem, calc(100vw - 2rem));
    max-height: 16rem;
    overflow: hidden;
  }

  :global(.snapshot-option) {
    justify-content: flex-start;
    min-height: 1.85rem;
    max-width: 100%;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  :global(.snapshot-icon-button) {
    width: 1.55rem;
    height: 1.55rem;
    min-height: 1.55rem;
    padding: 0;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
    box-shadow: none;
  }

  :global(.snapshot-icon-button:hover:not(:disabled)),
  :global(.snapshot-icon-button:focus-visible) {
    outline: none;
    background: color-mix(in oklab, var(--ui-surface-muted) 52%, transparent);
    color: var(--ui-text-primary);
  }

  :global(.snapshot-icon-button:focus-visible) {
    box-shadow: var(--ui-focus-ring);
  }

  :global(.snapshot-icon-button.confirming-delete) {
    color: var(--ui-danger);
  }

  .extension-filter-group {
    display: inline-flex;
    align-items: center;
    gap: 0.16rem;
    flex: 0 1 auto;
    min-width: 0;
    padding: 0.12rem;
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-muted) 24%, transparent);
  }

  .extension-filter {
    min-height: 1.32rem;
    padding: 0 0.46rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
    cursor: pointer;
    font-size: var(--text-xs);
    font-weight: 650;
    line-height: 1;
  }

  .extension-filter:hover,
  .extension-filter:focus-visible {
    outline: none;
    background: color-mix(in oklab, var(--ui-surface-muted) 45%, transparent);
    color: var(--ui-text-primary);
  }

  .extension-filter:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  .extension-filter.active {
    background: color-mix(in oklab, var(--ui-surface-raised) 92%, transparent);
    color: var(--ui-text-primary);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--ui-border-soft) 70%, transparent);
  }

  :global(.new-extension-button) {
    flex: 0 0 auto;
    height: 1.42rem;
    min-height: 1.42rem;
    padding-block: 0;
    line-height: 1;
    text-transform: none;
  }

  :global(.new-extension-button .ui-button-content) {
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    height: 100%;
    align-items: center;
    line-height: 1;
  }

  :global(.new-extension-button .ui-button-content > svg) {
    display: block;
  }

  :global(.new-extension-button .ui-button-content > span) {
    display: block;
    line-height: 1;
  }

  .new-extension-popover {
    display: grid;
    grid-template-columns: minmax(9rem, 15rem) minmax(12rem, 1fr) max-content;
    align-items: center;
    gap: 0.32rem;
    padding: 0.42rem 1.1rem;
    border-bottom: 1px solid var(--ui-border-subtle);
    background: color-mix(in oklab, var(--ui-surface-subtle) 32%, transparent);
  }

  .extensions-list {
    display: grid;
    align-content: start;
    gap: 0.22rem;
    min-height: 0;
    min-width: 0;
    overflow: auto;
    padding: 0.52rem 0.72rem 1rem;
  }

  .extension-icon-action {
    display: grid;
    place-items: center;
    width: 1.32rem;
    height: var(--agent-row-line-height);
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
  }

  .extension-icon-action:not(:disabled) {
    cursor: pointer;
  }

  .extension-icon-action:not(:disabled):hover,
  .extension-icon-action:not(:disabled):focus-visible {
    outline: none;
    background: var(--ui-hover-bg);
    color: var(--ui-text-primary);
  }

  .extension-icon-action.danger:not(:disabled):hover,
  .extension-icon-action.danger:not(:disabled):focus-visible {
    color: var(--ui-danger);
  }

  .extension-icon-action:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  .extension-icon-action:disabled {
    cursor: default;
    opacity: 0.48;
  }

  .extension-kind-icon {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 1.45rem;
    height: var(--agent-row-line-height);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-secondary);
    background: color-mix(in oklab, var(--ui-surface-muted) 38%, transparent);
  }

  .extension-kind-icon.instructions {
    color: color-mix(in oklab, var(--ui-accent) 80%, var(--ui-text-primary));
  }

  .extension-kind-icon.native_tool {
    color: color-mix(in oklab, var(--ui-success) 76%, var(--ui-text-primary));
  }

  .extension-kind-icon.svvyx {
    color: color-mix(in oklab, var(--ui-warning) 82%, var(--ui-text-primary));
  }

  .extension-default-controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(10rem, max-content));
    gap: 0.46rem;
    min-width: 0;
  }

  .extension-default-control {
    display: grid;
    grid-template-columns: minmax(6.2rem, max-content) auto;
    align-items: center;
    gap: 0.34rem;
    min-width: 0;
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .extension-default-control > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .extension-defaults-section {
    display: grid;
    gap: 0.42rem;
    min-width: 0;
  }

  .extension-expanded-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.72rem;
    min-width: 0;
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1;
  }

  .extension-expanded-section-header strong {
    color: var(--ui-text-primary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
  }

  .extension-minimal-hint {
    margin: -0.38rem 0 0;
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
    line-height: 1.45;
  }

  .extension-instruction-list {
    display: grid;
    gap: 0.42rem;
    min-width: 0;
  }

  .extension-instruction-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-width: 0;
  }

  .extension-instruction-list-header strong {
    color: var(--ui-text-primary);
    font-size: var(--text-xs);
  }

  .extension-instruction-row {
    display: grid;
    grid-template-columns: 1.55rem minmax(0, 1fr);
    gap: 0.38rem;
    min-width: 0;
  }

  .extension-instruction-row-actions {
    display: grid;
    align-content: start;
    gap: 0.16rem;
  }

  .scripted-instruction-contributor,
  .extension-tooling-section {
    display: grid;
    gap: 0.42rem;
    min-width: 0;
  }

  .extension-readonly-block {
    display: grid;
    gap: 0.34rem;
    min-width: 0;
    padding: 0.42rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 62%, transparent);
  }

  .extension-readonly-block-bar {
    display: flex;
    align-items: center;
    gap: 0.38rem;
    min-width: 0;
  }

  .extension-readonly-block-bar strong {
    overflow: hidden;
    color: var(--ui-text-primary);
    font-size: var(--text-sm);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .extension-readonly-block-bar span {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .extension-readonly-block pre {
    max-height: 14rem;
    overflow: auto;
    margin: 0;
    padding: 0.55rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface);
    color: var(--ui-text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.45;
    white-space: pre-wrap;
  }

  .snapshot-popover {
    position: absolute;
    z-index: var(--ui-z-dialog);
    top: calc(100% + 0.3rem);
    left: 0;
    display: grid;
    grid-template-columns: minmax(13rem, 1fr) max-content;
    align-items: center;
    gap: 0.18rem;
    width: min(22rem, calc(100vw - 1rem));
    padding: 0.22rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 78%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-raised) 96%, transparent);
    box-shadow:
      0 12px 28px color-mix(in oklab, var(--ui-shadow) 22%, transparent),
      0 0 0 1px color-mix(in oklab, var(--ui-surface) 42%, transparent);
  }

  .snapshot-name-input {
    width: 100%;
    min-height: 1.6rem;
    padding: 0.18rem 0.42rem;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-muted) 34%, transparent);
    color: var(--ui-text-primary);
    font-size: var(--text-sm);
    line-height: 1.2;
  }

  .snapshot-name-input:focus-visible {
    outline: none;
    border-color: color-mix(in oklab, var(--ui-accent) 36%, transparent);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--ui-accent) 16%, transparent);
  }

  .extension-settings {
    display: grid;
    gap: 0.45rem;
    align-items: center;
  }

  .extension-settings.empty {
    justify-items: start;
  }

  .extension-settings-empty,
  .extension-settings-loading {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  .request-input-mode,
  .request-input-timeout-toggle,
  .request-input-timeout-field {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .request-input-timeout-toggle,
  .request-input-timeout-field,
  .extension-settings-error {
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
  }

  .request-input-timeout-field input {
    width: 5.2rem;
    padding: 0.28rem 0.38rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface);
    color: var(--ui-text-primary);
  }

  .extension-settings-error {
    margin: 0;
    color: var(--ui-danger);
  }

  .extension-cli-requirements,
  .extension-env-requirements {
    display: grid;
    gap: 0.32rem;
    margin-top: 0.2rem;
  }

  .external-instruction-readonly {
    display: grid;
    gap: 0.35rem;
    margin-top: 0.45rem;
    min-width: 0;
  }

  .external-instruction-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    color: var(--ui-text-tertiary);
    font-size: 0.72rem;
  }

  .external-instruction-readonly code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-secondary);
    font-size: 0.72rem;
  }

  .external-instruction-readonly pre {
    max-height: 8rem;
    overflow: auto;
    margin: 0;
    padding: 0.5rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface-subtle);
    color: var(--ui-text-secondary);
    font-size: 0.72rem;
    line-height: 1.45;
    white-space: pre-wrap;
  }

  .external-instruction-controls {
    display: grid;
    gap: 0.42rem;
    min-width: 9.5rem;
  }

  .external-instruction-enable,
  .external-instruction-actor {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    min-width: 0;
    color: var(--ui-text-secondary);
    font-size: 0.72rem;
    line-height: 1.2;
  }

  .external-instruction-enable {
    color: var(--ui-text-primary);
    font-weight: 600;
  }

  .external-instruction-actors {
    display: grid;
    gap: 0.24rem;
  }

  .extension-cli-requirement,
  .extension-env-requirement {
    min-width: 0;
  }

  .extension-cli-requirement,
  .extension-env-requirement-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.32rem 0.45rem;
    min-width: 0;
  }

  .extension-cli-requirement span,
  .extension-env-requirement span,
  .extension-cli-loading,
  .extension-cli-error {
    color: var(--ui-text-tertiary);
    font-size: 0.72rem;
  }

  .extension-cli-requirement code {
    max-width: 100%;
    overflow-wrap: anywhere;
    color: var(--ui-text-secondary);
    font-size: 0.72rem;
  }

  .extension-cli-error {
    color: var(--ui-danger);
  }

  .generated-context-preview {
    min-height: 0;
    overflow: auto;
    padding: 1rem 1.1rem;
  }

  .generated-context-preview-meta {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .generated-context-preview-meta p {
    margin: 0 0 0.2rem;
    color: var(--ui-text-tertiary);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .generated-context-preview-meta h3 {
    margin: 0;
    font-size: 1rem;
  }

  .generated-context-preview-meta span,
  .generated-context-preview-tags {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  .generated-context-preview-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.72rem;
    margin-top: 0.7rem;
  }

  .generated-context-preview pre {
    min-width: 0;
    margin: 0.7rem 0 0;
    overflow: auto;
    padding: 0.72rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: pre-wrap;
  }
</style>
