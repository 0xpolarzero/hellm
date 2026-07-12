<script lang="ts">
  import BanIcon from "@lucide/svelte/icons/ban";
  import CheckIcon from "@lucide/svelte/icons/check";
  import Code2Icon from "@lucide/svelte/icons/code-2";
  import CopyPlusIcon from "@lucide/svelte/icons/copy-plus";
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import HammerIcon from "@lucide/svelte/icons/hammer";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import SaveIcon from "@lucide/svelte/icons/save";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { onDestroy, onMount, tick } from "svelte";
  import { flip } from "svelte/animate";
  import type {
    AppPreferences,
    ExternalInstructionActor,
    ExternalInstructionControl,
  } from "../shared/agent-settings";
  import { DEFAULT_EXTERNAL_INSTRUCTION_ACTORS } from "../shared/agent-settings";
  import type {
    AgentContextPreviewResponse,
    ExtensionCliRequirementReadiness,
    ExtensionEnvRequirementReadiness,
    ExtensionInventoryItemReadModel,
    ExtensionSnapshotReadModel,
    ExtensionsInventoryReadModel,
    SettingsReadModel,
  } from "../shared/workspace-contract";
  import type { ExtensionInterfaceKind } from "@svvy/core";
  import type { ChatRuntime } from "./chat-runtime";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import Checkbox from "./ui/Checkbox.svelte";
  import CompactCombobox, { type CompactComboboxOption } from "./ui/CompactCombobox.svelte";
  import OpenExternalButton from "./ui/OpenExternalButton.svelte";
  import Tooltip from "./ui/Tooltip.svelte";
  import { dismissConfirmation } from "./ui/dismiss-confirmation";
  import ExtensionEnvValueForm from "./ExtensionEnvValueForm.svelte";
  import ExtensionGeneratedFileViewer from "./ExtensionGeneratedFileViewer.svelte";
  import ExtensionInstructionFileEditor from "./ExtensionInstructionFileEditor.svelte";
  import ExtensionListRow from "./ExtensionListRow.svelte";
  import { queuedMessageOrderChanged, reorderQueuedMessageItems } from "./queued-message-order";

  type Props = {
    runtime: ChatRuntime;
    targetExtensionId?: string | null;
    targetView?: "inventory" | "generated-context-preview";
  };

  let { runtime, targetExtensionId = null, targetView = "inventory" }: Props = $props();
  let settings = $state<SettingsReadModel | null>(null);
  let appPreferences = $state<AppPreferences | null>(null);
  let contextPreview = $state<AgentContextPreviewResponse | null>(null);
  let extensionsInventory = $state<ExtensionsInventoryReadModel | null>(null);
  let settingsError = $state<string | null>(null);
  let inventoryError = $state<string | null>(null);
  let pendingSettings = $state(false);
  let pendingRequestUserInputSetting = $state<
    "mode" | "timeout-enabled" | "timeout-duration" | null
  >(null);
  let loadingPreview = $state(false);
  let loadingInventory = $state(true);
  let pendingExternalInstructionPath = $state<string | null>(null);
  let selectedSnapshotId = $state("");
  let snapshotName = $state("");
  let snapshotPopoverOpen = $state(false);
  let renamingSnapshotId = $state<string | null>(null);
  let renameSnapshotName = $state("");
  let confirmingDeleteSnapshotId = $state<string | null>(null);
  let confirmingDeleteExtensionId = $state<string | null>(null);
  let confirmingResetExtensionId = $state<string | null>(null);
  let confirmingDeleteInstructionKey = $state<string | null>(null);
  let confirmingResetOrder = $state(false);
  let snapshotAction = $state<"save" | "rename" | "delete" | "load" | null>(null);
  let snapshotNameInput = $state<HTMLInputElement | null>(null);
  let renameSnapshotInput = $state<HTMLInputElement | null>(null);
  let expandedExtensionIds = $state<Set<string>>(new Set());
  let expandedToolingIds = $state<Set<string>>(new Set());
  let extensionFilter = $state<"all" | ExtensionInterfaceKind>("all");
  let pendingExtensionActions = $state<Set<string>>(new Set());
  let extensionInventoryMutationGeneration = 0;
  let appliedExtensionInventoryMutationGeneration = 0;
  let extensionInventoryNeedsSettledRefresh = false;
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

  const FILTERS: Array<{ id: "all" | ExtensionInterfaceKind; label: string }> = [
    { id: "all", label: "All" },
    { id: "instructions", label: "Prompt" },
    { id: "native_tool", label: "Native" },
    { id: "svvyx", label: "svvyx" },
  ];

  function inventoryRows(): ExtensionInventoryItemReadModel[] {
    const rows = extensionsInventory?.extensions ?? [];
    return orderedInventoryRows(rows).filter(
      (extension) => extensionFilter === "all" || extension.interface === extensionFilter,
    );
  }

  function orderedInventoryRows(rows: ExtensionInventoryItemReadModel[]) {
    const order = extensionsInventory?.defaults?.order ?? [];
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

  function toggleToolingExpanded(extensionId: string) {
    if (expandedToolingIds.has(extensionId)) {
      expandedToolingIds.delete(extensionId);
    } else {
      expandedToolingIds.add(extensionId);
    }
    expandedToolingIds = new Set(expandedToolingIds);
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

  function contributorBypassed(
    contributor: ExtensionInventoryItemReadModel["loadedInstructionContributors"][number],
  ): boolean {
    return contributor.kind === "source" ? contributor.file.bypassed : contributor.bypassed;
  }

  function generatedApiLabel(extension: ExtensionInventoryItemReadModel): string | null {
    if (!extension.typescriptApiEnabled) return null;
    return "TS API";
  }

  function customizedExtension(extension: ExtensionInventoryItemReadModel): boolean {
    return extension.customized;
  }

  function extensionNeedsBuild(extension: ExtensionInventoryItemReadModel): boolean {
    return extension.state.issues.some(
      (issue) => issue.code === "BUILD_REQUIRED" || issue.code === "NO_CURRENT_BUILD",
    );
  }

  function extensionHasCliIssue(extension: ExtensionInventoryItemReadModel): boolean {
    return extension.state.issues.some(
      (issue) => issue.code === "CLI_MISSING" || issue.code === "CLI_STATUS_UNKNOWN",
    );
  }

  function extensionCanBuild(extension: ExtensionInventoryItemReadModel): boolean {
    return extensionNeedsBuild(extension) && !extensionHasCliIssue(extension);
  }

  function instructionActionKey(extensionId: string, name: string, action: string): string {
    return `instruction:${action}:${extensionId}:${name}`;
  }

  function instructionDeleteKey(extensionId: string, name: string): string {
    return `${extensionId}:${name}`;
  }

  function buildRequiredExtensions(): ExtensionInventoryItemReadModel[] {
    return inventoryRows().filter(extensionCanBuild);
  }

  function isExtensionActionPending(key: string): boolean {
    return pendingExtensionActions.has(key);
  }

  function startExtensionAction(key: string): void {
    pendingExtensionActions.add(key);
    pendingExtensionActions = new Set(pendingExtensionActions);
  }

  function finishExtensionAction(key: string): void {
    pendingExtensionActions.delete(key);
    pendingExtensionActions = new Set(pendingExtensionActions);
    if (pendingExtensionActions.size === 0 && extensionInventoryNeedsSettledRefresh) {
      extensionInventoryNeedsSettledRefresh = false;
      void loadExtensionsInventory({ clearError: false });
    }
  }

  async function applyExtensionInventoryMutation(
    mutation: Promise<ExtensionsInventoryReadModel>,
  ): Promise<void> {
    const generation = ++extensionInventoryMutationGeneration;
    const inventory = await mutation;
    extensionInventoryNeedsSettledRefresh = true;
    if (generation >= appliedExtensionInventoryMutationGeneration) {
      appliedExtensionInventoryMutationGeneration = generation;
      extensionsInventory = inventory;
    }
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
    const actionKey = "new";
    if (!title || isExtensionActionPending(actionKey)) return;
    const id = newExtensionId(title);
    startExtensionAction(actionKey);
    inventoryError = null;
    try {
      await applyExtensionInventoryMutation(
        runtime.createExtension({
          id,
          title,
          description: newExtensionDescription.trim() || `${title} prompt extension.`,
        }),
      );
      newExtensionTitle = "";
      newExtensionDescription = "";
      newExtensionOpen = false;
      expandedExtensionIds.add(id);
      expandedExtensionIds = new Set(expandedExtensionIds);
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Unable to create extension.";
    } finally {
      finishExtensionAction(actionKey);
    }
  }

  async function duplicateExtension(extension: ExtensionInventoryItemReadModel) {
    const actionKey = `duplicate:${extension.id}`;
    if (isExtensionActionPending(actionKey) || extension.interface === "native_tool") return;
    const title = `${extension.title} Copy`;
    const id = uniqueExtensionId(newExtensionId(title));
    startExtensionAction(actionKey);
    inventoryError = null;
    try {
      await applyExtensionInventoryMutation(
        runtime.duplicateExtension({
          extensionId: extension.id,
          id,
          title,
        }),
      );
      expandedExtensionIds.add(id);
      expandedExtensionIds = new Set(expandedExtensionIds);
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Unable to duplicate extension.";
    } finally {
      finishExtensionAction(actionKey);
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
    const actionKey = `delete:${extension.id}`;
    if (
      isExtensionActionPending(actionKey) ||
      extension.category === "builtin" ||
      confirmingDeleteExtensionId !== extension.id
    ) {
      return;
    }
    startExtensionAction(actionKey);
    inventoryError = null;
    try {
      await applyExtensionInventoryMutation(runtime.deleteExtension({ extensionId: extension.id }));
      confirmingDeleteExtensionId = null;
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Unable to delete extension.";
    } finally {
      finishExtensionAction(actionKey);
    }
  }

  function requestDeleteExtension(extension: ExtensionInventoryItemReadModel): void {
    if (extension.category === "builtin" || isExtensionActionPending(`delete:${extension.id}`)) {
      return;
    }
    confirmingResetExtensionId = null;
    confirmingDeleteExtensionId = extension.id;
  }

  function cancelExtensionActionConfirmation(): void {
    confirmingDeleteExtensionId = null;
    confirmingResetExtensionId = null;
  }

  async function resetExtension(extension: ExtensionInventoryItemReadModel) {
    const actionKey = `reset:${extension.id}`;
    if (
      isExtensionActionPending(actionKey) ||
      extension.category !== "builtin" ||
      confirmingResetExtensionId !== extension.id
    ) {
      return;
    }
    startExtensionAction(actionKey);
    inventoryError = null;
    try {
      await applyExtensionInventoryMutation(runtime.resetExtension({ extensionId: extension.id }));
      confirmingResetExtensionId = null;
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Unable to reset extension.";
    } finally {
      finishExtensionAction(actionKey);
    }
  }

  function requestResetExtension(extension: ExtensionInventoryItemReadModel): void {
    if (extension.category !== "builtin" || isExtensionActionPending(`reset:${extension.id}`)) {
      return;
    }
    confirmingDeleteExtensionId = null;
    confirmingResetExtensionId = extension.id;
  }

  async function buildExtension(extensionId: string) {
    const actionKey = `build:${extensionId}`;
    if (isExtensionActionPending(actionKey)) return;
    startExtensionAction(actionKey);
    inventoryError = null;
    try {
      await applyExtensionInventoryMutation(runtime.buildExtension({ extensionId }));
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Unable to build extension.";
    } finally {
      finishExtensionAction(actionKey);
    }
  }

  async function buildRequiredExtensionSet() {
    const extensions = buildRequiredExtensions();
    const actionKey = "build-all";
    if (extensions.length === 0 || isExtensionActionPending(actionKey)) return;
    startExtensionAction(actionKey);
    inventoryError = null;
    try {
      let inventory: ExtensionsInventoryReadModel | null = null;
      for (const extension of extensions) {
        inventory = await runtime.buildExtension({ extensionId: extension.id });
      }
      if (inventory) {
        extensionsInventory = inventory;
      }
      extensionInventoryNeedsSettledRefresh = true;
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Unable to build extensions.";
    } finally {
      finishExtensionAction(actionKey);
    }
  }

  async function addInstructionFile(extension: ExtensionInventoryItemReadModel) {
    const actionKey = `instruction:add:${extension.id}`;
    if (isExtensionActionPending(actionKey)) return;
    const nextIndex = extension.loadedInstructionContributors.length + 1;
    const name = `${String(nextIndex * 10).padStart(3, "0")}-notes.md`;
    startExtensionAction(actionKey);
    inventoryError = null;
    try {
      await applyExtensionInventoryMutation(
        runtime.addExtensionInstructionFile({
          extensionId: extension.id,
          name,
        }),
      );
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to add instruction file.";
    } finally {
      finishExtensionAction(actionKey);
    }
  }

  async function removeInstructionFile(extensionId: string, name: string) {
    const deleteKey = instructionDeleteKey(extensionId, name);
    const actionKey = instructionActionKey(extensionId, name, "remove");
    if (confirmingDeleteInstructionKey !== deleteKey) return;
    if (isExtensionActionPending(actionKey)) return;
    startExtensionAction(actionKey);
    inventoryError = null;
    try {
      await applyExtensionInventoryMutation(
        runtime.removeExtensionInstructionFile({ extensionId, name }),
      );
      confirmingDeleteInstructionKey = null;
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to remove instruction file.";
    } finally {
      finishExtensionAction(actionKey);
    }
  }

  function requestDeleteInstructionFile(extensionId: string, name: string): void {
    if (isExtensionActionPending(instructionActionKey(extensionId, name, "remove"))) return;
    confirmingDeleteInstructionKey = instructionDeleteKey(extensionId, name);
  }

  function cancelDeleteInstructionConfirmation(): void {
    confirmingDeleteInstructionKey = null;
  }

  async function setInstructionBypassed(extensionId: string, name: string, bypassed: boolean) {
    const actionKey = instructionActionKey(extensionId, name, "bypass");
    if (isExtensionActionPending(actionKey)) return;
    startExtensionAction(actionKey);
    inventoryError = null;
    try {
      await applyExtensionInventoryMutation(
        runtime.configureExtensionInstructionFile({
          extensionId,
          name,
          bypassed,
        }),
      );
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to update instruction file.";
    } finally {
      finishExtensionAction(actionKey);
    }
  }

  async function setExtensionTypescriptApi(extension: ExtensionInventoryItemReadModel, enabled: boolean) {
    const actionKey = `typescript-api:${extension.id}`;
    if (isExtensionActionPending(actionKey) || extension.interface !== "svvyx") return;
    startExtensionAction(actionKey);
    inventoryError = null;
    try {
      await applyExtensionInventoryMutation(
        runtime.setExtensionTypescriptApi({
          extensionId: extension.id,
          enabled,
        }),
      );
      await applyExtensionInventoryMutation(runtime.buildExtension({ extensionId: extension.id }));
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to update TypeScript API setting.";
    } finally {
      finishExtensionAction(actionKey);
    }
  }

  async function resetExtensionOrder(): Promise<void> {
    const actionKey = "order";
    if (isExtensionActionPending(actionKey) || !confirmingResetOrder) return;
    startExtensionAction(actionKey);
    inventoryError = null;
    try {
      await applyExtensionInventoryMutation(runtime.reorderExtensionDefaults({ extensionIds: [] }));
      confirmingResetOrder = false;
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : "Unable to reset extension order.";
    } finally {
      finishExtensionAction(actionKey);
    }
  }

  function requestResetExtensionOrder(): void {
    if (isExtensionActionPending("order")) return;
    confirmingResetOrder = true;
  }

  function cancelResetExtensionOrderConfirmation(): void {
    confirmingResetOrder = false;
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

  function declaredCliRequirementBinaries(extension: ExtensionInventoryItemReadModel): string[] {
    return extension.requirements.cliRequirements.map((requirement) => requirement.binary);
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
        envName: requirement.name,
        value,
      });
      return;
    }
    extensionsInventory = await runtime.setExtensionEnvOverride({
      extensionId,
      envName: requirement.name,
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
        envName: requirement.name,
      });
      return;
    }
    extensionsInventory = await runtime.removeExtensionEnvOverride({
      extensionId,
      envName: requirement.name,
    });
  }

  async function loadSettings(): Promise<void> {
    try {
      settingsError = null;
      settings = await runtime.getSettings();
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

  async function loadExtensionsInventory(options: { clearError?: boolean } = {}): Promise<void> {
    loadingInventory = !extensionsInventory;
    if (options.clearError !== false) {
      inventoryError = null;
    }
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
    const nextSettings = runtime.settingsSnapshot;
    const nextPreferences = runtime.appPreferencesSnapshot;
    const nextInventory = runtime.extensionsInventorySnapshot;
    if (nextSettings) {
      settings = nextSettings;
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

  async function setRequestInputVariant(mode: "nonblocking" | "blocking"): Promise<void> {
    if (!settings || pendingSettings) return;
    pendingSettings = true;
    pendingRequestUserInputSetting = "mode";
    settingsError = null;
    try {
      settings = await runtime.setRequestInputVariant({ mode });
    } catch (error) {
      settingsError = error instanceof Error ? error.message : "Unable to save settings.";
    } finally {
      pendingSettings = false;
      pendingRequestUserInputSetting = null;
    }
  }

  async function setRequestInputBlockingTimeout(
    patch: Partial<SettingsReadModel["requestInput"]["blockingTimeout"]>,
    pendingKey: "timeout-enabled" | "timeout-duration",
  ): Promise<void> {
    if (!settings || pendingSettings) return;
    const current = settings.requestInput.blockingTimeout;
    pendingSettings = true;
    pendingRequestUserInputSetting = pendingKey;
    settingsError = null;
    try {
      settings = await runtime.setRequestInputBlockingTimeout({
        enabled: patch.enabled ?? current.enabled,
        durationMs: patch.durationMs ?? current.durationMs,
      });
    } catch (error) {
      settingsError = error instanceof Error ? error.message : "Unable to save settings.";
    } finally {
      pendingSettings = false;
      pendingRequestUserInputSetting = null;
    }
  }

  function updateBlockingTimeoutSeconds(value: string): void {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return;
    void setRequestInputBlockingTimeout(
      {
        durationMs: (Math.max(1, Math.floor(seconds)) *
          1000) as SettingsReadModel["requestInput"]["blockingTimeout"]["durationMs"],
      },
      "timeout-duration",
    );
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
    return () => {
      unsubscribeRuntime();
    };
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
        <div
          use:dismissConfirmation={{
            active: confirmingResetOrder,
            onDismiss: cancelResetExtensionOrderConfirmation,
          }}
        >
          <Tooltip label={confirmingResetOrder ? "Confirm reset default extension order" : "Reset default extension order"}>
            <button
              type="button"
              class="extension-toolbar-action"
              disabled={isExtensionActionPending("order")}
              onclick={() =>
                confirmingResetOrder
                  ? void resetExtensionOrder()
                  : requestResetExtensionOrder()}
            >
              {#if confirmingResetOrder}
                <CheckIcon aria-hidden="true" size={12} strokeWidth={1.9} />
                Confirm
              {:else}
                <RotateCcwIcon aria-hidden="true" size={12} strokeWidth={1.9} />
                Order
              {/if}
            </button>
          </Tooltip>
        </div>
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
          {#if buildRequiredExtensions().length > 0}
            <Tooltip label={`Build ${buildRequiredExtensions().length} extension${buildRequiredExtensions().length === 1 ? "" : "s"}`}>
              <Button
                class="new-extension-button"
                variant="ghost"
                size="xs"
                disabled={isExtensionActionPending("build-all")}
                onclick={() => void buildRequiredExtensionSet()}
              >
                <HammerIcon aria-hidden="true" size={13} strokeWidth={2} />
                <span>Build all</span>
              </Button>
            </Tooltip>
          {/if}
          <Button
            class="new-extension-button"
            variant="ghost"
            size="xs"
            disabled={isExtensionActionPending("new")}
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
          disabled={!newExtensionTitle.trim() || isExtensionActionPending("new")}
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
      {@const declaredCliBinaries = declaredCliRequirementBinaries(extension)}
      {@const expanded = expandedExtensionIds.has(extension.id)}
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
            {#if extensionHasCliIssue(extension)}
              <Badge tone="danger">CLI</Badge>
            {:else if extension.state.issues.length > 0 && !extensionNeedsBuild(extension)}
              <Badge tone="warning">Issue</Badge>
            {/if}
          {/snippet}
          {#snippet actions()}
            <div
              class="extension-row-action-confirmation"
              use:dismissConfirmation={{
                active:
                  confirmingDeleteExtensionId === extension.id ||
                  confirmingResetExtensionId === extension.id,
                onDismiss: cancelExtensionActionConfirmation,
              }}
            >
              {#if extensionCanBuild(extension)}
                <Tooltip label="Build generated instruction, command schema, and TypeScript API output for this extension.">
                  <button
                    type="button"
                    class="extension-status-action"
                    disabled={isExtensionActionPending(`build:${extension.id}`)}
                    onclick={() => void buildExtension(extension.id)}
                  >
                    <HammerIcon size={12} aria-hidden="true" />
                    Build
                  </button>
                </Tooltip>
              {/if}
              <Tooltip label={extension.interface === "native_tool" ? "Native tool extensions cannot be duplicated" : "Duplicate extension"}>
                <button
                  type="button"
                  class="extension-icon-action"
                  disabled={extension.interface === "native_tool" || isExtensionActionPending(`duplicate:${extension.id}`)}
                  aria-label={`Duplicate ${extension.title}`}
                  onclick={() => duplicateExtension(extension)}
                >
                  <CopyPlusIcon size={13} aria-hidden="true" />
                </button>
              </Tooltip>
              {#if confirmingResetExtensionId === extension.id}
                <Tooltip label="Confirm reset">
                  <button
                    type="button"
                    class="extension-icon-action"
                    disabled={isExtensionActionPending(`reset:${extension.id}`)}
                    aria-label={`Confirm resetting ${extension.title}`}
                    onclick={() => resetExtension(extension)}
                  >
                    <CheckIcon size={13} aria-hidden="true" />
                  </button>
                </Tooltip>
              {:else}
                <Tooltip label={extension.category === "builtin" ? "Reset builtin extension" : "Only builtin extensions can be reset"}>
                  <button
                    type="button"
                    class="extension-icon-action"
                    disabled={extension.category !== "builtin" || isExtensionActionPending(`reset:${extension.id}`)}
                    aria-label={`Reset ${extension.title}`}
                    onclick={() => requestResetExtension(extension)}
                  >
                    <RotateCcwIcon size={13} aria-hidden="true" />
                  </button>
                </Tooltip>
              {/if}
              {#if confirmingDeleteExtensionId === extension.id}
                <Tooltip label="Confirm delete">
                  <button
                    type="button"
                    class="extension-icon-action danger"
                    disabled={isExtensionActionPending(`delete:${extension.id}`)}
                    aria-label={`Confirm deleting ${extension.title}`}
                    onclick={() => deleteExtension(extension)}
                  >
                    <CheckIcon size={13} aria-hidden="true" />
                  </button>
                </Tooltip>
              {:else}
                <Tooltip label={extension.category === "builtin" ? "builtin extensions cannot be deleted" : "Delete extension"}>
                  <button
                    type="button"
                    class="extension-icon-action danger"
                    disabled={extension.category === "builtin" || isExtensionActionPending(`delete:${extension.id}`)}
                    aria-label={`Delete ${extension.title}`}
                    onclick={() => requestDeleteExtension(extension)}
                  >
                    <Trash2Icon size={13} aria-hidden="true" />
                  </button>
                </Tooltip>
              {/if}
            </div>
          {/snippet}
          {#snippet expandedContent()}
          {#if extension.interface === "svvyx"}
            <section class="extension-top-controls" aria-label={`${extension.title} TypeScript API`}>
              <Tooltip label="Adds generated runtime facade declarations to the execute_typescript API for this extension. Toggling rebuilds the extension.">
                <label class="extension-inline-checkbox">
                  <Checkbox
                    size="sm"
                    checked={extension.typescriptApiEnabled}
                    disabled={isExtensionActionPending(`typescript-api:${extension.id}`)}
                    onchange={(event) =>
                      setExtensionTypescriptApi(
                        extension,
                        (event.currentTarget as HTMLInputElement).checked,
                      )}
                  />
                  <span>Enable TypeScript API</span>
                </label>
              </Tooltip>
            </section>
          {/if}
          {#if extension.id === "request-user-input"}
            <section class="extension-top-controls" aria-label="Request User Input mode">
              {#if settingsError}
                <p class="extension-settings-error" role="alert">{settingsError}</p>
              {/if}
              {#if settings}
                <div class="request-input-settings">
                  <span class="request-input-settings-label">request_user_input behavior</span>
                  <div class="request-input-mode" role="group" aria-label="Request User Input behavior">
                    <Tooltip label="Creates a user prompt and immediately returns default answers so the agent can continue. Later user answers arrive as queued follow-up.">
                      <button
                        type="button"
                        class={`request-input-mode-button ${settings.requestInput.mode === "nonblocking" ? "active" : ""}`.trim()}
                        aria-pressed={settings.requestInput.mode === "nonblocking"}
                        disabled={pendingRequestUserInputSetting === "mode"}
                        onclick={() => setRequestInputVariant("nonblocking")}
                      >
                        Nonblocking
                      </button>
                    </Tooltip>
                    <Tooltip label="Creates a user prompt and waits for the user answer or configured timeout before returning.">
                      <button
                        type="button"
                        class={`request-input-mode-button ${settings.requestInput.mode === "blocking" ? "active" : ""}`.trim()}
                        aria-pressed={settings.requestInput.mode === "blocking"}
                        disabled={pendingRequestUserInputSetting === "mode"}
                        onclick={() => setRequestInputVariant("blocking")}
                      >
                        Blocking
                      </button>
                    </Tooltip>
                  </div>
                  <div
                    class={`request-input-timeout-controls ${settings.requestInput.mode === "blocking" ? "active" : ""}`.trim()}
                    aria-hidden={settings.requestInput.mode !== "blocking"}
                  >
                    <label class="request-input-timeout-toggle">
                      <Checkbox
                        size="sm"
                        checked={settings.requestInput.blockingTimeout.enabled}
                        disabled={settings.requestInput.mode !== "blocking" || pendingRequestUserInputSetting === "timeout-enabled"}
                        onchange={(event) =>
                          setRequestInputBlockingTimeout(
                            { enabled: (event.currentTarget as HTMLInputElement).checked },
                            "timeout-enabled",
                          )}
                      />
                      <span>Timeout</span>
                    </label>
                    <label class="request-input-timeout-field">
                      <span>Seconds</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        disabled={settings.requestInput.mode !== "blocking" || pendingRequestUserInputSetting === "timeout-duration" || !settings.requestInput.blockingTimeout.enabled}
                        value={Math.round(settings.requestInput.blockingTimeout.durationMs / 1000)}
                        onchange={(event) =>
                          updateBlockingTimeoutSeconds((event.currentTarget as HTMLInputElement).value)}
                      />
                    </label>
                  </div>
                </div>
              {:else}
                <span class="extension-settings-loading">Loading</span>
              {/if}
            </section>
          {/if}
          {#if cliRequirements.length}
            <div class="extension-cli-requirements" aria-label={`${extension.title} CLI readiness`}>
              {#each cliRequirements as requirement (requirement.id)}
                {@const command = cliRequirementCommand(requirement)}
                <div class="extension-cli-requirement">
                  <div class="extension-cli-requirement-main">
                    <Badge tone={cliRequirementTone(requirement)}>
                      {cliRequirementLabel(requirement)}
                    </Badge>
                    <span>{cliRequirementVersions(requirement)}</span>
                    {#if command}
                      <span class="extension-cli-command">Shell: <code>{command}</code></span>
                    {/if}
                  </div>
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
                editor={appPreferences?.preferredExternalEditor}
                onSaved={() => void loadExtensionsInventory()}
              />
            </div>
          {/if}
          {#if extension.loadedInstructionContributors.length}
            <div class="extension-instruction-list">
              <div class="extension-instruction-list-header">
                <strong>Loaded instructions</strong>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={isExtensionActionPending(`instruction:add:${extension.id}`) || extension.category === "external_instruction"}
                  onclick={() => addInstructionFile(extension)}
                >
                  <PlusIcon size={13} aria-hidden="true" />
                  Add
                </Button>
              </div>
              {#each extension.loadedInstructionContributors as contributor (contributor.kind === "source" ? contributor.file.name : contributor.name)}
                <div class="extension-instruction-row">
                  {#if contributor.kind === "source"}
                    <ExtensionInstructionFileEditor
                      runtime={runtime}
                      extensionId={extension.id}
                      file={contributor.file}
                      editor={appPreferences?.preferredExternalEditor}
                      onSaved={() => void loadExtensionsInventory()}
                    >
                      {#snippet footerControls()}
                        <Tooltip label={contributorBypassed(contributor) ? "Include in context" : "Bypass without deleting"}>
                          <button
                            type="button"
                            class={`extension-footer-icon-action ${contributorBypassed(contributor) ? "is-bypassed" : ""}`.trim()}
                            disabled={isExtensionActionPending(instructionActionKey(extension.id, contributor.file.name, "bypass"))}
                            aria-label={contributorBypassed(contributor) ? "Include contributor" : "Bypass contributor"}
                            onclick={() =>
                              setInstructionBypassed(
                                extension.id,
                                contributor.file.name,
                                !contributorBypassed(contributor),
                              )}
                          >
                            <BanIcon size={12} aria-hidden="true" />
                          </button>
                        </Tooltip>
                        <span
                          class="extension-footer-confirmation"
                          use:dismissConfirmation={{
                            active:
                              confirmingDeleteInstructionKey ===
                              instructionDeleteKey(extension.id, contributor.file.name),
                            onDismiss: cancelDeleteInstructionConfirmation,
                          }}
                        >
                          {#if confirmingDeleteInstructionKey === instructionDeleteKey(extension.id, contributor.file.name)}
                            <Tooltip label="Confirm delete">
                              <button
                                type="button"
                                class="extension-footer-icon-action danger"
                                disabled={isExtensionActionPending(instructionActionKey(extension.id, contributor.file.name, "remove"))}
                                aria-label="Confirm deleting instruction contributor"
                                onclick={() => removeInstructionFile(extension.id, contributor.file.name)}
                              >
                                <CheckIcon size={12} aria-hidden="true" />
                              </button>
                            </Tooltip>
                          {:else}
                            <Tooltip label={contributor.file.editable ? "Delete instruction file" : "Only source instruction files can be removed"}>
                              <button
                                type="button"
                                class="extension-footer-icon-action danger"
                                disabled={isExtensionActionPending(instructionActionKey(extension.id, contributor.file.name, "remove")) || !contributor.file.editable}
                                aria-label="Delete instruction contributor"
                                onclick={() => requestDeleteInstructionFile(extension.id, contributor.file.name)}
                              >
                                <Trash2Icon size={12} aria-hidden="true" />
                              </button>
                            </Tooltip>
                          {/if}
                        </span>
                      {/snippet}
                    </ExtensionInstructionFileEditor>
                  {:else}
                    <div class="scripted-instruction-contributor">
                      <ExtensionInstructionFileEditor
                        runtime={runtime}
                        extensionId={extension.id}
                        kind="script"
                        file={contributor.script}
                        showTokenCount={false}
                        editor={appPreferences?.preferredExternalEditor}
                        onSaved={() => void loadExtensionsInventory()}
                      >
                        {#snippet footerControls()}
                          {#if extensionCanBuild(extension)}
                            <Tooltip label={`Build generated instruction with ${contributor.regenerateCommand}`}>
                              <button
                                type="button"
                                class="extension-footer-text-action"
                                disabled={isExtensionActionPending(`build:${extension.id}`)}
                                onclick={() => void buildExtension(extension.id)}
                              >
                                <HammerIcon size={12} aria-hidden="true" />
                                Build
                              </button>
                            </Tooltip>
                          {/if}
                        {/snippet}
                      </ExtensionInstructionFileEditor>
                      <ExtensionInstructionFileEditor
                        runtime={runtime}
                        extensionId={extension.id}
                        file={contributor.output}
                        editor={appPreferences?.preferredExternalEditor}
                        onSaved={() => void loadExtensionsInventory()}
                      >
                        {#snippet footerControls()}
                          <Tooltip label={contributorBypassed(contributor) ? "Include in context" : "Bypass without deleting"}>
                            <button
                              type="button"
                              class={`extension-footer-icon-action ${contributorBypassed(contributor) ? "is-bypassed" : ""}`.trim()}
                              disabled={isExtensionActionPending(instructionActionKey(extension.id, contributor.output.name, "bypass"))}
                              aria-label={contributorBypassed(contributor) ? "Include contributor" : "Bypass contributor"}
                              onclick={() =>
                                setInstructionBypassed(
                                  extension.id,
                                  contributor.output.name,
                                  !contributorBypassed(contributor),
                                )}
                            >
                              <BanIcon size={12} aria-hidden="true" />
                            </button>
                          </Tooltip>
                        {/snippet}
                      </ExtensionInstructionFileEditor>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <Button
              size="xs"
              variant="ghost"
              disabled={isExtensionActionPending(`instruction:add:${extension.id}`) || extension.category === "external_instruction"}
              onclick={() => addInstructionFile(extension)}
            >
              <PlusIcon size={13} aria-hidden="true" />
              Add instruction file
            </Button>
          {/if}
          {#if extension.tooling.nativeToolSchema || extension.tooling.svvyxCommandSource || extension.tooling.svvyxCommandSchema || extension.tooling.typescriptApiStatus !== "disabled"}
            <ExtensionListRow
              id={`${extension.id}:tooling`}
              title="Tooling"
              description="Tool schemas, command source, generated command schema, and TypeScript API output."
              draggable={false}
              dragLabel={`${extension.title} tooling`}
              expanded={expandedToolingIds.has(extension.id)}
              expandedInset={false}
              showDragHandle={false}
              showLeading={false}
              onToggle={() => toggleToolingExpanded(extension.id)}
            >
              {#snippet meta()}
                {#if extension.tooling.nativeToolSchema}
                  <Badge tone="neutral">Native</Badge>
                {/if}
                {#if extension.tooling.svvyxCommandSource || extension.tooling.svvyxCommandSchema}
                  <Badge tone="info">svvyx</Badge>
                {/if}
                {#if extension.tooling.typescriptApiDeclaration}
                  <Badge tone="info">TS API</Badge>
                {:else if extension.tooling.typescriptApiStatus === "not_emitted"}
                  <Badge tone="warning">TS API pending</Badge>
                {/if}
              {/snippet}
              {#snippet actions()}
                {#if extensionCanBuild(extension)}
                  <Tooltip label="Build generated instruction, command schema, and TypeScript API output for this extension.">
                    <button
                      type="button"
                      class="extension-status-action"
                      disabled={isExtensionActionPending(`build:${extension.id}`)}
                      onclick={() => void buildExtension(extension.id)}
                    >
                      <HammerIcon size={12} aria-hidden="true" />
                      Build
                    </button>
                  </Tooltip>
                {/if}
              {/snippet}
              {#snippet expandedContent()}
                <div class="extension-tooling-files" aria-label={`${extension.title} tooling files`}>
                  {#if extension.tooling.nativeToolSchema}
                    <ExtensionGeneratedFileViewer
                      runtime={runtime}
                      extensionId={extension.id}
                      block={extension.tooling.nativeToolSchema}
                      editor={appPreferences?.preferredExternalEditor}
                    />
                  {/if}
                  {#if extension.tooling.svvyxCommandSource}
                    <ExtensionInstructionFileEditor
                      runtime={runtime}
                      extensionId={extension.id}
                      file={extension.tooling.svvyxCommandSource}
                      showTokenCount={false}
                      editor={appPreferences?.preferredExternalEditor}
                      onSaved={() => void loadExtensionsInventory()}
                    >
                      {#snippet footerControls()}
                        <Tooltip label="Build command schema from source/index.ts">
                          <button
                            type="button"
                            class="extension-footer-text-action"
                            disabled={isExtensionActionPending(`build:${extension.id}`)}
                            onclick={() => void buildExtension(extension.id)}
                          >
                            <HammerIcon size={12} aria-hidden="true" />
                            Build
                          </button>
                        </Tooltip>
                      {/snippet}
                    </ExtensionInstructionFileEditor>
                  {/if}
                  {#if extension.tooling.svvyxCommandSchema}
                    <ExtensionGeneratedFileViewer
                      runtime={runtime}
                      extensionId={extension.id}
                      block={extension.tooling.svvyxCommandSchema}
                      editor={appPreferences?.preferredExternalEditor}
                    />
                  {/if}
                  {#if extension.tooling.typescriptApiDeclaration}
                    <ExtensionGeneratedFileViewer
                      runtime={runtime}
                      extensionId={extension.id}
                      block={extension.tooling.typescriptApiDeclaration}
                      editor={appPreferences?.preferredExternalEditor}
                    />
                  {:else if extension.tooling.typescriptApiStatus === "not_emitted"}
                    <div class="extension-tooling-note">
                      TypeScript API is enabled, but this extension has not emitted declarations yet.
                    </div>
                  {/if}
                </div>
              {/snippet}
            </ExtensionListRow>
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
          {#if extension.externalInstruction}
          {@const control = externalInstructionControl(extension)}
          {@const isSavingExternalInstruction = pendingExternalInstructionPath === extension.externalInstruction.path}
          <div class="extension-settings">
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

  .extension-toolbar-history-row {
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
    overflow-x: hidden;
    overflow-y: scroll;
    padding: 0.52rem 0.72rem 1rem;
    scrollbar-gutter: stable;
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

  .extension-row-action-confirmation {
    display: inline-flex;
    align-items: center;
    gap: 0.16rem;
    min-width: 0;
  }

  .extension-status-action {
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    place-items: center;
    align-items: center;
    gap: 0.22rem;
    height: 1.32rem;
    min-width: 0;
    padding: 0 0.36rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-muted) 34%, transparent);
    color: var(--ui-text-secondary);
    cursor: pointer;
    font: inherit;
    font-size: var(--text-xs);
    font-weight: 700;
    line-height: 1;
  }

  .extension-status-action:hover:not(:disabled),
  .extension-status-action:focus-visible:not(:disabled) {
    outline: none;
    background: var(--ui-hover-bg);
    color: var(--ui-text-primary);
  }

  .extension-status-action:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  .extension-status-action:disabled {
    cursor: default;
    opacity: 0.58;
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

  .extension-top-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }

  .extension-inline-checkbox {
    display: inline-flex;
    align-items: center;
    gap: 0.34rem;
    min-width: 0;
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
    font-weight: 650;
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
    display: block;
    min-width: 0;
  }

  .scripted-instruction-contributor,
  .extension-tooling-files {
    display: grid;
    gap: 0.42rem;
    min-width: 0;
  }

  .extension-tooling-note {
    padding: 0.42rem 0.5rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 62%, transparent);
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
    line-height: 1.35;
  }

  .extension-footer-icon-action,
  .extension-footer-text-action {
    display: inline-grid;
    place-items: center;
    min-width: 0;
    height: 1.16rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
    cursor: pointer;
  }

  .extension-footer-icon-action {
    width: 1.16rem;
  }

  .extension-footer-icon-action.is-bypassed {
    color: color-mix(in oklab, var(--ui-warning) 82%, var(--ui-text-primary));
    background: color-mix(in oklab, var(--ui-warning) 10%, transparent);
  }

  .extension-footer-confirmation {
    display: inline-flex;
    align-items: center;
    height: 1.16rem;
    min-width: 0;
  }

  .extension-footer-text-action {
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    gap: 0.22rem;
    padding: 0 0.28rem;
    font: inherit;
    font-size: var(--text-xs);
    font-weight: 700;
  }

  .extension-footer-icon-action:hover:not(:disabled),
  .extension-footer-icon-action:focus-visible:not(:disabled),
  .extension-footer-text-action:hover:not(:disabled),
  .extension-footer-text-action:focus-visible:not(:disabled) {
    outline: none;
    background: var(--ui-hover-bg);
    color: var(--ui-text-primary);
  }

  .extension-footer-icon-action.danger:hover:not(:disabled),
  .extension-footer-icon-action.danger:focus-visible:not(:disabled) {
    color: var(--ui-danger);
  }

  .extension-footer-icon-action:disabled,
  .extension-footer-text-action:disabled {
    cursor: default;
    opacity: 0.48;
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

  .extension-settings-loading {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  .request-input-settings,
  .request-input-timeout-toggle,
  .request-input-timeout-field {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .request-input-settings {
    align-items: center;
    flex-wrap: wrap;
    gap: 0.34rem 0.48rem;
    min-height: 1.72rem;
    min-width: 0;
  }

  .request-input-settings-label {
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
    font-weight: 650;
  }

  .request-input-mode {
    display: inline-flex;
    align-items: center;
    gap: 0.16rem;
    min-height: 1.56rem;
    padding: 0.12rem;
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-muted) 24%, transparent);
  }

  .request-input-mode-button {
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

  .request-input-mode-button:hover:not(:disabled),
  .request-input-mode-button:focus-visible:not(:disabled) {
    outline: none;
    background: color-mix(in oklab, var(--ui-surface-muted) 45%, transparent);
    color: var(--ui-text-primary);
  }

  .request-input-mode-button:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  .request-input-mode-button.active {
    background: color-mix(in oklab, var(--ui-surface-raised) 92%, transparent);
    color: var(--ui-text-primary);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--ui-border-soft) 70%, transparent);
  }

  .request-input-mode-button:disabled {
    cursor: default;
    opacity: 0.58;
  }

  .request-input-timeout-toggle,
  .request-input-timeout-field,
  .extension-settings-error {
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
  }

  .request-input-timeout-controls {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 1.72rem;
    min-width: 0;
    visibility: hidden;
    pointer-events: none;
  }

  .request-input-timeout-controls.active {
    visibility: visible;
    pointer-events: auto;
  }

  .request-input-timeout-field input {
    width: 5.2rem;
    height: 1.56rem;
    padding: 0 0.38rem;
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

  .extension-cli-requirement {
    display: grid;
    gap: 0.4rem;
    min-width: 0;
  }

  .extension-env-requirement {
    min-width: 0;
  }

  .extension-cli-requirement-main,
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
