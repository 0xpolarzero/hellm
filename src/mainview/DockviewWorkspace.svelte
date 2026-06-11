<script lang="ts">
  import { mount, unmount } from "svelte";
  import { onDestroy, onMount } from "svelte";
  import {
    DockviewComponent,
    type GroupPanelPartInitParameters,
    type IContentRenderer,
    type IHeaderActionsRenderer,
    type ITabGroupChipRenderer,
    type IDisposable,
    type ITabRenderer,
    type IWatermarkRenderer,
    type SerializedDockview,
    type TabPartInitParameters,
  } from "dockview-core";
  // oxlint-disable-next-line import/no-unassigned-import
  import "dockview-core/dist/styles/dockview.css";
  import DockviewPanelHost from "./DockviewPanelHost.svelte";
  import type { ChatRuntime } from "./chat-runtime";
  import type { AgentSettingsState, AppAppearance } from "../shared/agent-settings";
  import type { WorkspaceTabInfo } from "../shared/workspace-contract";
  import type { WorkspaceDockviewPanelState } from "./pane-layout";
  import { getSurfaceDisplayTitle } from "./surface-title";

  const TOOLTIP_DELAY_MS = 500;

  type DockviewPanelRenderer = "onlyWhenVisible" | "always";

  type Props = {
    runtime: ChatRuntime;
    panels: WorkspaceDockviewPanelState[];
    dockviewLayout: SerializedDockview | null;
    focusedPanelId: string | null;
    openingWorkspace?: boolean;
    openWorkspaceError?: string | null;
    recentWorkspaces?: WorkspaceTabInfo[];
    agentSettings?: AgentSettingsState | null;
    onFocusPanel: (panelId: string) => void;
    onOpenModelPicker: (panelId: string) => void;
    onAgentSettingsChanged?: (settings: AgentSettingsState) => void;
    onOpenWorkspace?: () => void;
    onOpenWorkspaceInNewTab?: () => void;
    onOpenAgentProfile?: (agentProfileId: string) => void;
    onProviderAuthChanged?: (providerId: string) => void | Promise<void>;
    onAppAppearanceChanged?: (appearance: AppAppearance) => void;
    onPersistDockview: (dockview: SerializedDockview | null, focusedPanelId: string | null) => void;
  };

  let {
    runtime,
    panels,
    dockviewLayout,
    focusedPanelId,
    openingWorkspace = false,
    openWorkspaceError = null,
    recentWorkspaces = [],
    agentSettings = null,
    onFocusPanel,
    onOpenModelPicker,
    onAgentSettingsChanged,
    onOpenWorkspace,
    onOpenWorkspaceInNewTab,
    onOpenAgentProfile,
    onProviderAuthChanged,
    onAppAppearanceChanged,
    onPersistDockview,
  }: Props = $props();
  let hostElement = $state<HTMLDivElement | null>(null);
  let dockview: DockviewComponent | null = null;
  let applying = false;
  let layoutFrame: number | null = null;
  let dockviewResizeObserver: ResizeObserver | null = null;
  let observedDockviewWidth = 0;
  let observedDockviewHeight = 0;
  let unsubscribeRuntime: (() => void) | null = null;
  let panelRenderKeys = new Map<string, string>();
  const tabRenderers = new Set<SurfaceTabRenderer>();
  const headerRenderers = new Set<SurfaceHeaderActionsRenderer>();

  type PaneTabState = "waiting" | "streaming" | "error" | null;

  type PaneTabPresentation = {
    title: string;
    typeLabel: string | null;
    state: PaneTabState;
  };

  class SurfaceContentRenderer implements IContentRenderer {
    readonly element = document.createElement("div");
    private component: Record<string, unknown> | null = null;
    private panelId = "";

    init(params: GroupPanelPartInitParameters): void {
      this.element.className = "dockview-surface-content";
      this.panelId = params.api.id;
      this.component = mount(DockviewPanelHost, {
        target: this.element,
        props: {
          runtime,
          panelId: this.panelId,
          agentSettings,
          onOpenModelPicker,
          onAgentSettingsChanged,
          openingWorkspace,
          openWorkspaceError,
          recentWorkspaces,
          onOpenWorkspace,
          onOpenWorkspaceInNewTab,
          onOpenAgentProfile,
          onProviderAuthChanged,
          onAppAppearanceChanged,
        },
      }) as Record<string, unknown>;
    }

    update(): void {
      if (!this.component) return;
      unmount(this.component);
      this.component = mount(DockviewPanelHost, {
        target: this.element,
        props: {
          runtime,
          panelId: this.panelId,
          agentSettings,
          onOpenModelPicker,
          onAgentSettingsChanged,
          openingWorkspace,
          openWorkspaceError,
          recentWorkspaces,
          onOpenWorkspace,
          onOpenWorkspaceInNewTab,
          onOpenAgentProfile,
          onProviderAuthChanged,
          onAppAppearanceChanged,
        },
      }) as Record<string, unknown>;
    }

    dispose(): void {
      if (this.component) {
        unmount(this.component);
        this.component = null;
      }
      this.element.replaceChildren();
    }
  }

  class SurfaceTabRenderer implements ITabRenderer {
    readonly element = document.createElement("button");
    private params: TabPartInitParameters | null = null;

    init(params: TabPartInitParameters): void {
      this.params = params;
      this.element.type = "button";
      this.element.className = "dockview-surface-tab";
      this.element.addEventListener("click", this.focus);
      tabRenderers.add(this);
      this.render();
    }

    update(): void {
      this.render();
    }

    dispose(): void {
      this.element.removeEventListener("click", this.focus);
      tabRenderers.delete(this);
    }

    private focus = (): void => {
      if (!this.params) return;
      this.params.containerApi.setActivePanel(this.params.api);
      onFocusPanel(this.params.api.id);
    };

    render(): void {
      const panelId = this.params?.api.id ?? "";
      const panel = panels.find((candidate) => candidate.panelId === panelId);
      const presentation = getPaneTabPresentation(panelId);

      this.element.replaceChildren();
      this.element.title = `${presentation.title}${presentation.typeLabel ? ` · ${presentation.typeLabel}` : ""}${
        presentation.state ? ` · ${presentation.state}` : ""
      }`;
      this.element.ariaLabel = this.element.title;
      this.element.dataset.focused = panel?.panelId === focusedPanelId ? "true" : "false";
      this.element.dataset.state = presentation.state ?? "idle";
      this.element.dataset.testid =
        panel?.panelId === focusedPanelId ? "active-surface-tab" : "surface-tab";

      const title = document.createElement("span");
      title.className = "dockview-surface-tab-title";
      title.textContent = presentation.title;
      title.dataset.testid =
        panel?.panelId === focusedPanelId ? "active-surface-title" : "surface-title";

      this.element.append(title);

      if (presentation.typeLabel) {
        const type = document.createElement("span");
        type.className = "dockview-surface-tab-type";
        type.textContent = presentation.typeLabel;
        this.element.append(type);
      }

      if (presentation.state) {
        const statePin = document.createElement("span");
        statePin.className = "dockview-surface-tab-state";
        statePin.dataset.state = presentation.state;
        statePin.ariaHidden = "true";
        this.element.append(statePin);
      }
    }
  }

  function refreshSurfaceTabs(): void {
    for (const renderer of tabRenderers) {
      renderer.render();
    }
    for (const renderer of headerRenderers) {
      renderer.refresh();
    }
  }

  function getPaneTabPresentation(panelId: string): PaneTabPresentation {
    const panel = panels.find((candidate) => candidate.panelId === panelId) ?? null;
    const binding = panel?.binding ?? null;
    const session = binding?.workspaceSessionId
      ? runtime.sessions.find((candidate) => candidate.id === binding.workspaceSessionId) ?? null
      : null;
    const controller = runtime.getPaneController(panelId);
    const typeLabel = getPaneTypeLabel(panel);
    const title = getSurfaceDisplayTitle(
      binding,
      runtime.sessions,
      session?.title ?? panel?.chrome?.title ?? "Surface",
    );

    return {
      title,
      typeLabel,
      state: getPaneTabState(panel, session, controller),
    };
  }

  function getPaneTypeLabel(panel: WorkspaceDockviewPanelState | null): string | null {
    switch (panel?.binding?.surface) {
      case "orchestrator":
        return "orchestrator";
      case "thread":
        return "handler";
      case "workflows":
      case "app-logs":
      case "open-workspace":
        return null;
      case "command":
        return "command";
      case "workflow-task-attempt":
        return "task";
      case "artifact":
        return "artifact";
      default:
        return null;
    }
  }

  function getPaneTabState(
    panel: WorkspaceDockviewPanelState | null,
    session: ChatRuntime["sessions"][number] | null,
    controller: ReturnType<ChatRuntime["getPaneController"]>,
  ): PaneTabState {
    if (controller?.agent.state.error || session?.status === "error") {
      return "error";
    }
    if (controller?.agent.state.isStreaming || controller?.promptStatus === "streaming") {
      return "streaming";
    }
    if (panel?.binding?.surface === "thread") {
      const threadId = panel.binding.threadId;
      if (threadId && session?.threadIdsByStatus?.waiting.includes(threadId)) {
        return "waiting";
      }
      return null;
    }
    if (panel?.binding?.surface === "orchestrator" && session?.status === "waiting") {
      return "waiting";
    }
    return null;
  }

  class SurfaceHeaderActionsRenderer implements IHeaderActionsRenderer {
    readonly element = document.createElement("div");
    private snapshotContainer = document.createElement("div");
    private snapshotComponent: Record<string, unknown> | null = null;
    private renderedSnapshotPanelId: string | null = null;
    private group: Parameters<IHeaderActionsRenderer["init"]>[0]["group"] | null = null;
    private activePanelDisposable: IDisposable | null = null;

    init(params: Parameters<IHeaderActionsRenderer["init"]>[0]): void {
      this.group = params.group;
      this.element.className = "dockview-surface-actions";
      this.snapshotContainer.className = "dockview-context-snapshot-actions";
      this.element.append(
        this.snapshotContainer,
        this.createActionButton("Duplicate pane right", "split-right", () => this.duplicate("right")),
        this.createActionButton("Duplicate pane below", "split-below", () => this.duplicate("below")),
        this.createActionButton("Close pane", "close", () => this.close()),
      );
      this.syncDisabledState();
      this.activePanelDisposable = params.api.onDidActivePanelChange(() => this.syncDisabledState());
      headerRenderers.add(this);
    }

    dispose(): void {
      headerRenderers.delete(this);
      this.activePanelDisposable?.dispose();
      this.activePanelDisposable = null;
      this.unmountSnapshotControls();
      this.element.replaceChildren();
      this.group = null;
    }

    private get activePanelId(): string | null {
      return this.group?.activePanel?.id ?? null;
    }

    private get activePanel(): WorkspaceDockviewPanelState | null {
      const panelId = this.activePanelId;
      return panelId ? (panels.find((candidate) => candidate.panelId === panelId) ?? null) : null;
    }

    private createActionButton(
      label: string,
      icon: "split-right" | "split-below" | "close",
      action: () => void,
    ): HTMLButtonElement {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `dockview-surface-action action-${icon}`;
      button.ariaLabel = label;
      button.innerHTML = getActionIcon(icon);
      attachDelayedTooltip(button, label);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      });
      return button;
    }

    private duplicate(direction: "right" | "below"): void {
      const panelId = this.activePanelId;
      if (!panelId) return;
      void runtime.splitPane(panelId, direction, { duplicateBinding: true });
    }

    private close(): void {
      const panelId = this.activePanelId;
      if (!panelId) return;
      void runtime.closePane(panelId);
    }

    private syncDisabledState(): void {
      this.syncSnapshotControls();
      const disabled = !this.activePanelId;
      for (const child of this.element.querySelectorAll<HTMLButtonElement>("button.dockview-surface-action")) {
        child.toggleAttribute("disabled", disabled);
      }
    }

    refresh(): void {
      this.syncDisabledState();
    }

    private syncSnapshotControls(): void {
      const panel = this.activePanel;
      const panelId = panel?.panelId ?? null;
      this.unmountSnapshotControls();
    }

    private unmountSnapshotControls(): void {
      if (this.snapshotComponent) {
        unmount(this.snapshotComponent);
        this.snapshotComponent = null;
      }
      this.renderedSnapshotPanelId = null;
      this.snapshotContainer.replaceChildren();
    }
  }

  class SurfaceWatermarkRenderer implements IWatermarkRenderer {
    readonly element = document.createElement("div");

    init(): void {
      this.element.className = "dockview-surface-watermark";
      this.element.dataset.testid = "dockview-watermark";

      const title = document.createElement("strong");
      title.textContent = "No panes open";
      const detail = document.createElement("span");
      detail.textContent = "Open a session, Logs, Agents, Extensions, Snippets, Workflows, or Settings.";
      this.element.replaceChildren(title, detail);
    }

    dispose(): void {
      this.element.replaceChildren();
    }
  }

  class SurfaceTabGroupChipRenderer implements ITabGroupChipRenderer {
    readonly element = document.createElement("button");

    init(params: Parameters<ITabGroupChipRenderer["init"]>[0]): void {
      this.element.type = "button";
      this.element.className = "dockview-tab-group-chip";
      this.element.dataset.testid = "dockview-tab-group-chip";
      this.render(params.tabGroup);
    }

    update(params: Parameters<NonNullable<ITabGroupChipRenderer["update"]>>[0]): void {
      this.render(params.tabGroup);
    }

    dispose(): void {
      this.element.replaceChildren();
    }

    private render(tabGroup: Parameters<ITabGroupChipRenderer["init"]>[0]["tabGroup"]): void {
      const label = tabGroup.label?.trim() || "Group";
      this.element.textContent = label;
      this.element.ariaLabel = `Tab group ${label}`;
      this.element.title = this.element.ariaLabel;
    }
  }

  function getActionIcon(icon: "split-right" | "split-below" | "close"): string {
    if (icon === "close") {
      return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.25 4.25 11.75 11.75M11.75 4.25 4.25 11.75" /></svg>';
    }
    if (icon === "split-below") {
      return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.75" y="2.75" width="10.5" height="10.5" rx="1.6" /><path d="M2.75 8h10.5" /><path d="M8 10.75v-2.5M6.75 9.5 8 10.75 9.25 9.5" /></svg>';
    }
    return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.75" y="2.75" width="10.5" height="10.5" rx="1.6" /><path d="M8 2.75v10.5" /><path d="M10.75 8.1h-2.5M9.5 6.85l1.25 1.25L9.5 9.35" /></svg>';
  }

  function removeAllDockviewTooltips(): void {
    for (const existingTooltip of document.querySelectorAll(".imperative-action-tooltip")) {
      existingTooltip.remove();
    }
  }

  function attachDelayedTooltip(button: HTMLButtonElement, label: string): void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tooltip: HTMLDivElement | null = null;

    const handlePointerOverOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && button.contains(target)) return;
      remove();
    };

    const remove = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      tooltip?.remove();
      tooltip = null;
      document.removeEventListener("pointerover", handlePointerOverOutside, true);
    };

    const show = () => {
      if (button.disabled || tooltip) return;
      removeAllDockviewTooltips();
      const rect = button.getBoundingClientRect();
      const margin = 10;
      const gap = 8;
      tooltip = document.createElement("div");
      tooltip.className = "imperative-action-tooltip";
      tooltip.textContent = label;
      tooltip.style.visibility = "hidden";
      document.body.append(tooltip);
      const tooltipRect = tooltip.getBoundingClientRect();
      const preferredLeft = rect.left + rect.width / 2 - tooltipRect.width / 2;
      const maxLeft = window.innerWidth - margin - tooltipRect.width;
      let actualLeft = Math.max(margin, preferredLeft);
      if (maxLeft < margin) {
        tooltip.style.left = `${margin}px`;
        tooltip.style.right = `${margin}px`;
        actualLeft = margin;
      } else if (preferredLeft > maxLeft) {
        tooltip.style.left = `${maxLeft}px`;
        tooltip.style.right = `${margin}px`;
        actualLeft = maxLeft;
      } else {
        tooltip.style.left = `${actualLeft}px`;
        tooltip.style.right = "";
      }
      const arrowLeft = Math.max(8, Math.min(tooltipRect.width - 8, rect.left + rect.width / 2 - actualLeft));
      tooltip.style.setProperty("--ui-tooltip-arrow-left", `${arrowLeft}px`);
      tooltip.style.top = `${Math.max(margin, Math.min(window.innerHeight - margin - tooltipRect.height, rect.bottom + gap))}px`;
      tooltip.style.visibility = "visible";
    };

    const schedule = (delayMs = TOOLTIP_DELAY_MS) => {
      remove();
      document.addEventListener("pointerover", handlePointerOverOutside, true);
      timer = setTimeout(show, delayMs);
    };

    button.addEventListener("pointerenter", () => schedule());
    button.addEventListener("focus", () => schedule(180));
    button.addEventListener("pointerleave", remove);
    button.addEventListener("blur", remove);
    button.addEventListener("click", remove);
  }

  function createDockview(): void {
    if (!hostElement || dockview) return;
    dockview = new DockviewComponent(hostElement, {
      proportionalLayout: true,
      createComponent: () => new SurfaceContentRenderer(),
      createTabComponent: () => new SurfaceTabRenderer(),
      createRightHeaderActionComponent: () => new SurfaceHeaderActionsRenderer(),
      createWatermarkComponent: () => new SurfaceWatermarkRenderer(),
      createTabGroupChipComponent: () => new SurfaceTabGroupChipRenderer(),
      defaultRenderer: "onlyWhenVisible",
      defaultTabComponent: "surfaceTab",
      noPanelsOverlay: "emptyGroup",
      dndEdges: {
        activationSize: { value: 72, type: "pixels" },
        size: { value: 28, type: "percentage" },
        smallWidthBoundary: 420,
        smallHeightBoundary: 280,
      },
      getTabContextMenuItems: ({ panel }) => [
        {
          label: "Duplicate Panel",
          action: () => void runtime.splitPane(panel.id, "right", { duplicateBinding: true }),
        },
        {
          label: "Close Panel",
          action: () => void runtime.closePane(panel.id),
        },
        "separator",
        "close",
      ],
    });

    dockview.onDidActivePanelChange((panel) => {
      if (!applying && panel) onFocusPanel(panel.id);
      persistDockview();
    });
    dockview.onDidAddPanel(() => persistDockview());
    dockview.onDidRemovePanel((panel) => {
      if (!applying) {
        void runtime.closePane(panel.id);
      }
      persistDockview();
    });
    dockview.onWillShowOverlay((event) => {
      if (!isAllowedDockviewDropData(event.getData())) {
        event.preventDefault();
      }
    });
    dockview.onWillDrop((event) => {
      if (!isAllowedDockviewDropData(event.getData())) {
        event.preventDefault();
      }
    });
    dockview.onUnhandledDragOverEvent((event) => {
      if (isAllowedDockviewDropData(event.getData())) {
        event.accept();
      }
    });
    dockview.onDidLayoutChange(() => persistDockview());
    dockview.onDidDrop(() => persistDockview());
    dockview.onDidCreateTabGroup(() => persistDockview());
    dockview.onDidDestroyTabGroup(() => persistDockview());
    syncDockviewPanels();
    if (dockviewLayout) {
      try {
        applying = true;
        dockview.fromJSON(dockviewLayout, { reuseExistingPanels: true });
      } catch {
        syncDockviewPanels();
      } finally {
        applying = false;
      }
      panelRenderKeys = new Map();
      syncDockviewPanels();
    }
    scheduleDockviewLayout();
  }

  function persistDockview(): void {
    if (!dockview || applying) return;
    onPersistDockview(dockview.toJSON(), dockview.activePanel?.id ?? null);
  }

  function layoutDockview(): void {
    if (!dockview || !hostElement) return;
    const width = hostElement.clientWidth;
    const height = hostElement.clientHeight;
    if (width <= 0 || height <= 0) return;
    const wasApplying = applying;
    applying = true;
    try {
      dockview.layout(width, height, true);
    } finally {
      applying = wasApplying;
    }
  }

  function syncDockviewLayoutFromResize(width: number, height: number): void {
    const nextWidth = Math.round(width);
    const nextHeight = Math.round(height);
    if (nextWidth === observedDockviewWidth && nextHeight === observedDockviewHeight) return;
    observedDockviewWidth = nextWidth;
    observedDockviewHeight = nextHeight;
    if (layoutFrame !== null) {
      window.cancelAnimationFrame(layoutFrame);
      layoutFrame = null;
    }
    layoutDockview();
  }

  function observeDockviewHostSize(): void {
    if (!hostElement || typeof ResizeObserver === "undefined") return;
    dockviewResizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      syncDockviewLayoutFromResize(entry.contentRect.width, entry.contentRect.height);
    });
    dockviewResizeObserver.observe(hostElement);
  }

  function scheduleDockviewLayout(): void {
    if (layoutFrame !== null) {
      window.cancelAnimationFrame(layoutFrame);
    }
    layoutFrame = window.requestAnimationFrame(() => {
      layoutFrame = null;
      layoutDockview();
    });
  }

  function getDockviewPanel(panelId: string) {
    return dockview?.panels.find((panel) => panel.id === panelId);
  }

  function isKnownDockviewDragPanel(panelId: string | null | undefined): boolean {
    return !!panelId && panels.some((panel) => panel.panelId === panelId);
  }

  function isAllowedDockviewDropData(data: { panelId: string | null; viewId: string } | undefined): boolean {
    if (!data) return false;
    return isKnownDockviewDragPanel(data.panelId) || isKnownDockviewDragPanel(data.viewId);
  }

  function runtimePanels(): WorkspaceDockviewPanelState[] {
    return runtime.paneLayout.panels;
  }

  function runtimeFocusedPanelId(): string | null {
    return runtime.paneLayout.focusedPanelId;
  }

  function getPanelRenderer(panel: WorkspaceDockviewPanelState): DockviewPanelRenderer {
    const surface = panel.binding?.surface;
    return surface === "orchestrator" || surface === "thread" ? "always" : "onlyWhenVisible";
  }

  function getPanelRenderKey(panel: WorkspaceDockviewPanelState): string {
    return JSON.stringify({
      binding: panel.binding,
      title: panel.chrome?.title ?? null,
      renderer: getPanelRenderer(panel),
      agentSettingsReady: panel.binding?.surface === "agents" ? Boolean(agentSettings) : undefined,
    });
  }

  function syncDockviewPanels(): void {
    if (!dockview) return;
    const nextPanels = runtimePanels();
    const nextFocusedPanelId = runtimeFocusedPanelId();
    applying = true;
    try {
      for (const panel of nextPanels) {
        const existingPanel = getDockviewPanel(panel.panelId);
        const renderKey = getPanelRenderKey(panel);
        if (!existingPanel) {
          const addedPanel = dockview.addPanel({
            id: panel.panelId,
            component: "surface",
            tabComponent: "surfaceTab",
            title: panel.chrome?.title ?? "Surface",
            renderer: getPanelRenderer(panel),
            minimumWidth: 0,
            minimumHeight: 0,
            inactive: panel.panelId !== nextFocusedPanelId,
            ...getDockviewAddPanelPlacement(panel),
          });
          if (panel.placement?.kind === "popout") {
            void dockview.addPopoutGroup(addedPanel, { position: panel.placement.box });
          }
          panelRenderKeys.set(panel.panelId, renderKey);
        } else if (panelRenderKeys.get(panel.panelId) !== renderKey) {
          existingPanel.setTitle(panel.chrome?.title ?? "Surface");
          existingPanel.setRenderer(getPanelRenderer(panel));
          existingPanel.update({ params: { renderKey } });
          panelRenderKeys.set(panel.panelId, renderKey);
        }
      }
      for (const panel of dockview.panels) {
        if (!nextPanels.some((candidate) => candidate.panelId === panel.id)) {
          dockview.removePanel(panel);
          panelRenderKeys.delete(panel.id);
        }
      }
      const focused = nextFocusedPanelId ? getDockviewPanel(nextFocusedPanelId) : undefined;
      if (focused && dockview.activePanel?.id !== focused.id) {
        dockview.setActivePanel(focused);
      }
    } finally {
      applying = false;
    }
  }

  function getDockviewAddPanelPlacement(panel: WorkspaceDockviewPanelState): Partial<Parameters<DockviewComponent["addPanel"]>[0]> {
    const fallbackReferencePanel = dockview?.activePanel ?? dockview?.panels[0];
    const placement = panel.placement;
    if (!dockview || dockview.totalPanels === 0 || !placement) {
      return {};
    }
    if (placement.kind === "split") {
      return {
        position: {
          referencePanel: getDockviewPanel(placement.referencePanelId) ?? fallbackReferencePanel!,
          direction: placement.direction,
        },
        initialWidth: placement.direction === "left" || placement.direction === "right" ? placement.size : undefined,
        initialHeight: placement.direction === "above" || placement.direction === "below" ? placement.size : undefined,
      };
    }
    if (placement.kind === "tab") {
      const referenceGroup = dockview.getGroup(placement.groupId);
      return referenceGroup
        ? {
            position: {
              referenceGroup,
              direction: "within",
              index: placement.index,
            },
          }
        : {};
    }
    if (placement.kind === "edge") {
      return {
        position: { direction: placement.direction },
        initialWidth: placement.direction === "left" || placement.direction === "right" ? placement.size : undefined,
        initialHeight: placement.direction === "above" || placement.direction === "below" ? placement.size : undefined,
      };
    }
    if (placement.kind === "floating") {
      return {
        floating: placement.box ?? true,
      };
    }
    return {
      position: {
        referencePanel: fallbackReferencePanel!,
        direction: "right",
      },
    };
  }

  $effect(() => {
    void panels;
    void focusedPanelId;
    void agentSettings;
    syncDockviewPanels();
    refreshSurfaceTabs();
    scheduleDockviewLayout();
  });

  onMount(() => {
    createDockview();
    observeDockviewHostSize();
    unsubscribeRuntime = runtime.subscribe(() => {
      syncDockviewPanels();
      refreshSurfaceTabs();
      scheduleDockviewLayout();
    });
  });

  onDestroy(() => {
    unsubscribeRuntime?.();
    unsubscribeRuntime = null;
    dockviewResizeObserver?.disconnect();
    dockviewResizeObserver = null;
    if (layoutFrame !== null) {
      window.cancelAnimationFrame(layoutFrame);
      layoutFrame = null;
    }
    dockview?.dispose();
    dockview = null;
  });
</script>

<div class="dockview-workbench" data-testid="dockview-workbench" bind:this={hostElement}></div>

<style>
  .dockview-workbench {
    min-height: 0;
    height: 100%;
    width: 100%;
    overflow: hidden;
    --dv-background-color: var(--ui-shell);
    --dv-group-view-background-color: var(--ui-bg);
    --dv-paneview-active-outline-color: var(--ui-accent);
    --dv-tabs-and-actions-container-background-color: var(--ui-chrome);
    --dv-activegroup-visiblepanel-tab-background-color: var(--ui-panel);
    --dv-inactivegroup-visiblepanel-tab-background-color: color-mix(in oklab, var(--ui-panel) 72%, var(--ui-shell));
    --dv-activegroup-hiddenpanel-tab-background-color: color-mix(in oklab, var(--ui-panel) 54%, var(--ui-shell));
    --dv-inactivegroup-hiddenpanel-tab-background-color: color-mix(in oklab, var(--ui-panel) 48%, var(--ui-shell));
    --dv-tab-divider-color: color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
    --dv-separator-border: var(--ui-border-soft);
    --dv-paneview-header-border-color: var(--ui-border-soft);
    --dv-icon-hover-background-color: color-mix(in oklab, var(--ui-surface-subtle) 78%, transparent);
    --dv-drag-over-background-color: color-mix(in oklab, var(--ui-accent) 18%, var(--ui-panel));
    --dv-tabs-container-scrollbar-color: var(--ui-border-strong);
  }

  :global(.dockview-workbench .dockview-theme-abyss),
  :global(.dockview-workbench .dockview-theme-abyss-spaced),
  :global(.dockview-workbench.dockview-theme-abyss),
  :global(.dockview-workbench.dockview-theme-abyss-spaced) {
    --dv-color-abyss-dark: var(--ui-bg);
    --dv-color-abyss: var(--ui-shell);
    --dv-color-abyss-light: var(--ui-panel);
    --dv-color-abyss-lighter: var(--ui-border-soft);
    --dv-color-abyss-accent: var(--ui-accent);
    --dv-color-abyss-primary-text: var(--ui-text);
    --dv-color-abyss-secondary-text: var(--ui-text-muted);
    --dv-group-view-background-color: var(--ui-bg);
    --dv-tabs-and-actions-container-background-color: var(--ui-chrome);
    --dv-activegroup-visiblepanel-tab-background-color: var(--ui-panel);
    --dv-inactivegroup-visiblepanel-tab-background-color: color-mix(in oklab, var(--ui-panel) 72%, var(--ui-shell));
    --dv-activegroup-hiddenpanel-tab-background-color: color-mix(in oklab, var(--ui-panel) 54%, var(--ui-shell));
    --dv-inactivegroup-hiddenpanel-tab-background-color: color-mix(in oklab, var(--ui-panel) 48%, var(--ui-shell));
    --dv-tab-divider-color: color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
    --dv-separator-border: var(--ui-border-soft);
    --dv-paneview-header-border-color: var(--ui-border-soft);
    --dv-paneview-active-outline-color: var(--ui-accent);
  }

  :global(.dockview-workbench .dv-dockview),
  :global(.dockview-workbench .dv-watermark-container),
  :global(.dockview-workbench .dv-watermark) {
    background: var(--ui-bg);
  }

  :global(.dockview-workbench .dv-tabs-and-actions-container),
  :global(.dockview-workbench .dv-void-container),
  :global(.dockview-workbench .dv-right-actions-container) {
    background: var(--dv-tabs-and-actions-container-background-color);
  }

  :global(.dockview-surface-watermark) {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 0.34rem;
    height: 100%;
    min-height: 11rem;
    padding: 1rem;
    color: var(--ui-text-tertiary);
    text-align: center;
  }

  :global(.dockview-surface-watermark strong) {
    color: var(--ui-text-secondary);
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.25;
  }

  :global(.dockview-surface-watermark span) {
    max-width: 24rem;
    font-size: var(--text-xs);
    line-height: 1.35;
  }

  :global(.dockview-tab-group-chip) {
    display: inline-flex;
    align-items: center;
    max-width: 8rem;
    height: 1.25rem;
    padding: 0 0.38rem;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 74%, transparent);
    color: var(--ui-text-tertiary);
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.dockview-workbench .dv-pane-container.dv-animated .dv-view),
  :global(.dockview-workbench .dv-split-view-container.dv-animation .dv-view),
  :global(.dockview-workbench .dv-split-view-container.dv-animation .dv-sash),
  :global(.dockview-workbench .dv-tab.dv-tab--shifting),
  :global(.dockview-workbench .dv-tab.dv-tab--dragging),
  :global(.dockview-workbench .dv-tab.dv-tab--group-collapsed),
  :global(.dockview-workbench .dv-tab.dv-tab--group-expanding),
  :global(.dockview-workbench .dv-tab-group-chip.dv-tab-group-chip--shifting),
  :global(.dockview-workbench .dv-tab-group-chip.dv-tab-group-chip--dragging),
  :global(.dockview-workbench .dv-tabs-container-vertical .dv-tab.dv-tab--group-collapsed),
  :global(.dockview-workbench .dv-tabs-container-vertical .dv-tab.dv-tab--group-expanding) {
    transition: none !important;
  }

  :global(.dockview-surface-content) {
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--ui-panel);
  }

  :global(.dockview-surface-tab) {
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    height: 100%;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--ui-text);
    font: inherit;
    font-size: var(--text-sm);
    padding: 0 0.55rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.dockview-surface-tab[data-focused="true"]) {
    color: var(--ui-accent);
  }

  :global(.dockview-surface-tab-title) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
    color: var(--ui-text-primary);
  }

  :global(.dockview-surface-tab-type) {
    flex: 0 0 auto;
    padding: 0.08rem 0.26rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-strong) 58%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 72%, transparent);
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1.15;
  }

  :global(.dockview-surface-tab-state) {
    flex: 0 0 auto;
    width: 0.43rem;
    height: 0.43rem;
    border-radius: 999px;
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--ui-panel) 86%, transparent);
  }

  :global(.dockview-surface-tab-state[data-state="streaming"]) {
    background: var(--ui-accent);
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--ui-accent) 42%, transparent),
      0 0 0.45rem color-mix(in oklab, var(--ui-accent) 42%, transparent);
    animation: dockview-state-pulse 1.4s ease-in-out infinite;
  }

  :global(.dockview-surface-tab-state[data-state="waiting"]) {
    background: var(--ui-status-waiting);
  }

  :global(.dockview-surface-tab-state[data-state="error"]) {
    background: var(--ui-danger);
  }

  @keyframes dockview-state-pulse {
    0%,
    100% {
      opacity: 0.62;
      transform: scale(0.92);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.dockview-surface-tab-state[data-state="streaming"]) {
      animation: none;
    }
  }

  :global(.dockview-surface-actions) {
    display: flex;
    align-items: center;
    gap: 0.16rem;
    height: 100%;
    padding: 0 0.32rem 0 0.18rem;
  }

  :global(.dockview-context-snapshot-actions) {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    height: 100%;
  }

  :global(.dockview-surface-action) {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 1.55rem;
    height: 1.55rem;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
    cursor: pointer;
    transition:
      border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      background-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      transform 120ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  :global(.dockview-surface-action:hover:not(:disabled)),
  :global(.dockview-surface-action:focus-visible) {
    border-color: var(--ui-border-soft);
    background: color-mix(in oklab, var(--ui-surface-subtle) 78%, transparent);
    color: var(--ui-text-primary);
    outline: none;
  }

  :global(.dockview-surface-action:focus-visible) {
    box-shadow: var(--ui-focus-ring);
  }

  :global(.dockview-surface-action:active:not(:disabled)) {
    transform: translateY(1px) scale(0.94);
  }

  :global(.dockview-surface-action:disabled) {
    cursor: default;
    opacity: 0.36;
  }

  :global(.dockview-surface-action svg) {
    width: 0.9rem;
    height: 0.9rem;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.55;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.dockview-surface-action) {
      transition:
        border-color 0.01ms linear,
        background-color 0.01ms linear,
        color 0.01ms linear;
    }

    :global(.dockview-surface-action:active:not(:disabled)) {
      transform: none;
    }
  }

  :global(.imperative-action-tooltip) {
    position: fixed;
    z-index: var(--ui-z-dialog);
    width: max-content;
    min-width: 8.5rem;
    max-width: min(18rem, calc(100vw - 1.25rem));
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--ui-tooltip-border);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-tooltip-bg);
    color: var(--ui-text-primary);
    box-shadow:
      0 10px 24px -14px color-mix(in oklab, var(--ui-shadow) 68%, transparent),
      0 2px 8px -4px color-mix(in oklab, var(--ui-shadow) 42%, transparent);
    font-size: var(--text-xs);
    font-weight: 500;
    line-height: 1.35;
    text-align: center;
    white-space: nowrap;
    pointer-events: none;
    animation: dockview-tooltip-in 120ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  :global(.imperative-action-tooltip::before) {
    position: absolute;
    top: -0.25rem;
    left: var(--ui-tooltip-arrow-left, 50%);
    width: 0.375rem;
    height: 0.375rem;
    border: 0 solid var(--ui-tooltip-border);
    border-top-width: 1px;
    border-left-width: 1px;
    background: var(--ui-tooltip-bg);
    content: "";
    pointer-events: none;
    transform: translateX(-50%) rotate(45deg);
  }

  @keyframes dockview-tooltip-in {
    from {
      opacity: 0;
      translate: 0 -0.125rem;
    }
    to {
      opacity: 1;
      translate: 0 0;
    }
  }
</style>
