<script lang="ts">
	import { onMount } from "svelte";
	import { HotkeysProvider } from "@tanstack/svelte-hotkeys";
	import ChatWorkspace from "./ChatWorkspace.svelte";
	import { createChatRuntime, type ChatRuntime } from "./chat-runtime";
	import { createChatStorage, type ChatStorage } from "./chat-storage";
	import { rpc } from "./rpc";
	import { applyAppAppearance } from "./theme";
	import StatusCard from "./ui/StatusCard.svelte";
	import type { WorkspaceTabStripItem } from "./WorkspaceTabStrip.svelte";
	import {
		reorderWorkspaceTabs,
		summarizeWorkspaceTabCounts,
		type WorkspaceTabCounts,
	} from "./workspace-tabs";
	import type {
		AppWorkspaceUiRestoreState,
		AppWorkspaceTabsState,
		WorkspaceInfoResponse,
		WorkspaceTabInfo,
	} from "../shared/workspace-contract";
	import type { AppAppearance } from "../shared/agent-settings";

	type OpenWorkspaceTab = {
		workspace: WorkspaceTabInfo;
		runtime: ChatRuntime;
		counts: WorkspaceTabCounts;
		unsubscribe: () => void;
	};

	type DetachedWorkspaceRuntime = {
		workspaceId: string;
		runtime: ChatRuntime;
		unsubscribe: () => void;
	};

	const storage: ChatStorage = createChatStorage();
	let tabs = $state<OpenWorkspaceTab[]>([]);
	const detachedRuntimes = new Map<string, DetachedWorkspaceRuntime>();
	let bootstrapError = $state<string | null>(null);
	let openingError = $state<string | null>(null);
	let restoreErrorsByWorkspaceTabId = $state<Record<string, string>>({});
	let restoring = $state(true);
	let openingWorkspace = $state(false);
	let knownWorkspaces = $state<WorkspaceTabInfo[]>([]);
	let disposed = false;
	let disposeAppearanceSync: (() => void) | null = null;
	const createWorkspaceTabId = () => `workspace-tab-${crypto.randomUUID()}`;
	let activeWorkspaceTabId = $state<string | null>(null);
	const activeTab = $derived(
		tabs.find((tab) => tab.workspace.workspaceTabId === activeWorkspaceTabId) ?? null,
	);
	const activeOpenWorkspaceError = $derived(
		openingError ??
			(activeWorkspaceTabId ? restoreErrorsByWorkspaceTabId[activeWorkspaceTabId] ?? null : null),
	);
	const workspaceTabItems = $derived<WorkspaceTabStripItem[]>(
		tabs.map((tab) => ({ workspace: tab.workspace, counts: tab.counts })),
	);

	function summarizeWorkspace(runtime: ChatRuntime): WorkspaceTabCounts {
		return summarizeWorkspaceTabCounts({
			sessions: runtime.sessions,
			appLogSummary: runtime.appLogSummary,
		});
	}

	function toWorkspaceTabInfo(
		workspace: WorkspaceInfoResponse | WorkspaceTabInfo,
		openedAt = new Date().toISOString(),
		workspaceTabId = "workspaceTabId" in workspace ? workspace.workspaceTabId : createWorkspaceTabId(),
	): WorkspaceTabInfo {
		return {
			...workspace,
			workspaceTabId,
			openedAt: "openedAt" in workspace ? workspace.openedAt : openedAt,
		};
	}

	function workspaceHistoryKey(workspace: WorkspaceTabInfo): string {
		return workspace.cwd.trim() || workspace.workspaceId;
	}

	function mergeKnownWorkspaces(
		existing: readonly WorkspaceTabInfo[],
		incoming: readonly WorkspaceTabInfo[],
	): WorkspaceTabInfo[] {
		const byKey = new Map<string, WorkspaceTabInfo>();
		for (const workspace of existing) {
			if (workspace.kind === "default") continue;
			byKey.set(workspaceHistoryKey(workspace), workspace);
		}
		for (const workspace of incoming) {
			if (workspace.kind === "default") continue;
			byKey.set(workspaceHistoryKey(workspace), workspace);
		}
		return [...byKey.values()].toSorted((left, right) =>
			left.workspaceLabel.localeCompare(right.workspaceLabel),
		);
	}

	async function persistWorkspaceTabs() {
		const openTabs = tabs.map((tab) => tab.workspace);
		knownWorkspaces = mergeKnownWorkspaces(knownWorkspaces, openTabs);
		const state: AppWorkspaceTabsState = {
			version: 4,
			activeWorkspaceTabId,
			tabs: openTabs,
			knownWorkspaces,
		};
		await rpc.request
			.setAppWorkspaceTabs(state)
			.catch((error) => console.error("Failed to persist app workspace tabs:", error));
	}

	function setAppAppearance(appearance: AppAppearance) {
		disposeAppearanceSync?.();
		disposeAppearanceSync = applyAppAppearance(appearance);
	}

	async function refreshAppAppearance() {
		try {
			const preferences = await rpc.request.getAppPreferences();
			setAppAppearance(preferences.appAppearance);
		} catch (error) {
			console.error("Failed to load app appearance:", error);
			setAppAppearance("system");
		}
	}

	async function createWorkspaceTab(
		workspace: WorkspaceInfoResponse | WorkspaceTabInfo,
		workspaceTabId?: string,
	): Promise<OpenWorkspaceTab> {
		const workspaceTab = toWorkspaceTabInfo(workspace, new Date().toISOString(), workspaceTabId);
		let tab: OpenWorkspaceTab;
		let runtime: ChatRuntime;
		runtime = await createChatRuntime(
			{
				workspaceInfo: workspaceTab,
				workspaceTabId: workspaceTab.workspaceTabId,
				initialLayoutId: workspaceTab.activeLayoutId,
				onActiveLayoutChange: (layoutId) => {
					workspaceTab.activeLayoutId = layoutId;
					if (tab) tab.workspace.activeLayoutId = layoutId;
					tabs = [...tabs];
					void persistWorkspaceTabs();
				},
				onWorkspaceLayoutPersist: (state) => {
					void syncOpenWorkspaceLayouts(workspaceTab.workspaceId, state, tab);
				},
				onMissingProviderAccess: () => {
					void runtime.openSurface({ surface: "settings" }, { kind: "focused-panel" });
				},
			},
			undefined,
			storage,
		);
		tab = {
			workspace: workspaceTab,
			runtime,
			counts: summarizeWorkspace(runtime),
			unsubscribe: () => {},
		};
		const unsubscribe = runtime.subscribe(() => {
			tab.counts = summarizeWorkspace(runtime);
			tabs = [...tabs];
		});
		tab.unsubscribe = unsubscribe;
		return tab;
	}

	async function syncOpenWorkspaceLayouts(
		workspaceId: string,
		state: AppWorkspaceUiRestoreState,
		sourceTab: OpenWorkspaceTab | undefined,
	) {
		await Promise.all(
			tabs
				.filter((candidate) => candidate !== sourceTab && candidate.workspace.workspaceId === workspaceId)
				.map((candidate) => candidate.runtime.syncWorkspaceLayoutState(state)),
		);
	}

	async function setActiveWorkspace(workspaceTabId: string | null) {
		activeWorkspaceTabId = workspaceTabId;
		const tab = tabs.find((candidate) => candidate.workspace.workspaceTabId === workspaceTabId) ?? null;
		if (!tab) {
			await persistWorkspaceTabs();
			return;
		}
		try {
			await rpc.request.setActiveWorkspace({ workspaceId: tab.workspace.workspaceId });
			await refreshAppAppearance();
		} catch (error) {
			console.error("Failed to set active workspace:", error);
		}
		await persistWorkspaceTabs();
	}

	function hasVisibleWorkspaceReference(workspaceId: string): boolean {
		return tabs.some((candidate) => candidate.workspace.workspaceId === workspaceId);
	}

	function releaseDetachedWorkspaceRuntime(workspaceId: string): void {
		const retained = detachedRuntimes.get(workspaceId);
		if (!retained) return;
		detachedRuntimes.delete(workspaceId);
		retained.unsubscribe();
		retained.runtime.dispose();
		void rpc.request
			.closeWorkspace({ workspaceId })
			.catch((error) => console.error("Failed to close retained workspace:", error));
	}

	function retainDetachedWorkspaceRuntime(tab: OpenWorkspaceTab): void {
		if (detachedRuntimes.has(tab.workspace.workspaceId)) return;
		if (summarizeWorkspace(tab.runtime).running <= 0) {
			tab.runtime.dispose();
			void rpc.request
				.closeWorkspace({ workspaceId: tab.workspace.workspaceId })
				.catch((error) => console.error("Failed to close workspace:", error));
			return;
		}
		const unsubscribe = tab.runtime.subscribe(() => {
			if (summarizeWorkspace(tab.runtime).running <= 0) {
				releaseDetachedWorkspaceRuntime(tab.workspace.workspaceId);
			}
		});
		detachedRuntimes.set(tab.workspace.workspaceId, {
			workspaceId: tab.workspace.workspaceId,
			runtime: tab.runtime,
			unsubscribe,
		});
	}

	function releaseVisualWorkspaceTab(tab: OpenWorkspaceTab): void {
		tab.unsubscribe();
		if (tab.counts.running > 0 && !hasVisibleWorkspaceReference(tab.workspace.workspaceId)) {
			retainDetachedWorkspaceRuntime(tab);
			return;
		}
		tab.runtime.dispose();
		void rpc.request
			.closeWorkspace({ workspaceId: tab.workspace.workspaceId })
			.catch((error) => console.error("Failed to close workspace:", error));
	}

	async function restoreWorkspaceTabs() {
		try {
			const restoreState = await rpc.request.getAppWorkspaceTabs().catch((error) => {
				console.error("Failed to load app workspace tabs:", error);
				return null;
			});
			knownWorkspaces = restoreState?.knownWorkspaces ?? [];
			const tabsToRestore = restoreState?.tabs.length ? restoreState.tabs : [];
			knownWorkspaces = mergeKnownWorkspaces(knownWorkspaces, tabsToRestore);

			const restoredTabs: OpenWorkspaceTab[] = [];
			for (const savedTab of tabsToRestore) {
				if (disposed) return;
				try {
					const workspaceInfo =
						savedTab.kind === "default"
							? await rpc.request.getDefaultWorkspace()
							: (await rpc.request.openWorkspace({ cwd: savedTab.cwd, workspaceTabId: savedTab.workspaceTabId })).workspace;
					if (!workspaceInfo) {
						throw new Error("Workspace did not resolve.");
					}
					restoredTabs.push(await createWorkspaceTab(toWorkspaceTabInfo(workspaceInfo, savedTab.openedAt, savedTab.workspaceTabId), savedTab.workspaceTabId));
				} catch (error) {
					if (savedTab.kind === "default") throw error;
					console.error("Failed to restore workspace tab:", error);
					const reason = error instanceof Error ? error.message : "Unable to open workspace.";
					restoreErrorsByWorkspaceTabId = {
						...restoreErrorsByWorkspaceTabId,
						[savedTab.workspaceTabId]: `Unable to restore ${savedTab.workspaceLabel}: ${reason}`,
					};
					const fallback = await rpc.request.getDefaultWorkspace();
					restoredTabs.push(await createWorkspaceTab(toWorkspaceTabInfo(fallback, savedTab.openedAt, savedTab.workspaceTabId), savedTab.workspaceTabId));
				}
			}

			if (disposed) {
				for (const tab of restoredTabs) {
					tab.unsubscribe();
					tab.runtime.dispose();
				}
				return;
			}

			tabs = restoredTabs;
			if (!tabs.length) {
				const openWorkspaces = await rpc.request.getOpenWorkspaces();
				const initialWorkspace =
					openWorkspaces.find((workspace) => workspace.kind === "user") ??
					(await rpc.request.getDefaultWorkspace());
				tabs = [await createWorkspaceTab(initialWorkspace)];
			}
			knownWorkspaces = mergeKnownWorkspaces(
				knownWorkspaces,
				restoredTabs.map((tab) => tab.workspace),
			);
			const savedActiveIndex = restoreState?.activeWorkspaceTabId
				? tabsToRestore.findIndex((tab) => tab.workspaceTabId === restoreState.activeWorkspaceTabId)
				: -1;
			const restoredActive =
				savedActiveIndex >= 0
					? (tabs[savedActiveIndex]?.workspace.workspaceTabId ?? tabs[0]?.workspace.workspaceTabId ?? null)
					: (tabs[0]?.workspace.workspaceTabId ?? null);
			await setActiveWorkspace(restoredActive);
			bootstrapError = null;
		} catch (error) {
			if (!disposed) {
				bootstrapError = error instanceof Error ? error.message : "Unable to initialize svvy.";
			}
		} finally {
			if (!disposed) {
				restoring = false;
			}
		}
	}

	async function openWorkspace(placement: "current-tab" | "new-tab" = "current-tab") {
		if (openingWorkspace) return;
		openingWorkspace = true;
		openingError = null;
		try {
			const response =
				placement === "new-tab"
					? await rpc.request.openWorkspace({ placement: "new-tab" })
					: await rpc.request.openWorkspace({ placement: "current-tab" });
			const workspaceInfo = response.workspace;
			if (!workspaceInfo) {
				return;
			}

			const knownWorkspace =
				workspaceInfo.kind === "user"
					? knownWorkspaces.find((workspace) => workspaceHistoryKey(workspace) === (workspaceInfo.cwd.trim() || workspaceInfo.workspaceId))
					: null;
			const workspaceForTab =
				knownWorkspace?.activeLayoutId && workspaceInfo.kind === "user"
					? { ...workspaceInfo, activeLayoutId: knownWorkspace.activeLayoutId }
					: workspaceInfo;
			const tab = await createWorkspaceTab(workspaceForTab, placement === "current-tab" ? activeWorkspaceTabId ?? undefined : undefined);
			if (disposed) {
				tab.unsubscribe();
				tab.runtime.dispose();
				return;
			}
			knownWorkspaces = mergeKnownWorkspaces(knownWorkspaces, [tab.workspace]);
			const { [tab.workspace.workspaceTabId]: _clearedRestoreError, ...remainingRestoreErrors } =
				restoreErrorsByWorkspaceTabId;
			restoreErrorsByWorkspaceTabId = remainingRestoreErrors;
			if (placement === "new-tab" || !activeWorkspaceTabId) {
				const activeIndex = tabs.findIndex((candidate) => candidate.workspace.workspaceTabId === activeWorkspaceTabId);
				tabs = [
					...tabs.slice(0, activeIndex + 1),
					tab,
					...tabs.slice(activeIndex + 1),
				];
			} else {
				const oldTab = tabs.find((candidate) => candidate.workspace.workspaceTabId === activeWorkspaceTabId);
				tabs = tabs.map((candidate) =>
					candidate.workspace.workspaceTabId === activeWorkspaceTabId ? tab : candidate,
				);
				if (oldTab) releaseVisualWorkspaceTab(oldTab);
			}
			await setActiveWorkspace(tab.workspace.workspaceTabId);
			bootstrapError = null;
		} catch (error) {
			openingError = error instanceof Error ? error.message : "Unable to open workspace.";
		} finally {
			openingWorkspace = false;
		}
	}

	async function createDefaultWorkspaceTab() {
		const defaultInfo = await rpc.request.getDefaultWorkspace();
		const tab = await createWorkspaceTab(defaultInfo);
		const activeIndex = tabs.findIndex((candidate) => candidate.workspace.workspaceTabId === activeWorkspaceTabId);
		tabs = [
			...tabs.slice(0, activeIndex + 1),
			tab,
			...tabs.slice(activeIndex + 1),
		];
		await setActiveWorkspace(tab.workspace.workspaceTabId);
	}

	async function closeWorkspaceTab(workspaceTabId: string) {
		const tab = tabs.find((candidate) => candidate.workspace.workspaceTabId === workspaceTabId);
		if (!tab) return;
		const { [workspaceTabId]: _clearedRestoreError, ...remainingRestoreErrors } =
			restoreErrorsByWorkspaceTabId;
		restoreErrorsByWorkspaceTabId = remainingRestoreErrors;
		const index = tabs.indexOf(tab);
		if (tabs.length === 1) {
			const defaultInfo = await rpc.request.getDefaultWorkspace();
			const replacementTab = await createWorkspaceTab(defaultInfo);
			if (disposed) {
				replacementTab.unsubscribe();
				replacementTab.runtime.dispose();
				return;
			}
			tabs = [replacementTab];
			activeWorkspaceTabId = replacementTab.workspace.workspaceTabId;
			releaseVisualWorkspaceTab(tab);
			await setActiveWorkspace(replacementTab.workspace.workspaceTabId);
			return;
		}
		const closingActiveTab = activeWorkspaceTabId === workspaceTabId;
		const remainingTabs = tabs.filter((candidate) => candidate.workspace.workspaceTabId !== workspaceTabId);
		const nextActiveTabId =
			closingActiveTab
				? (remainingTabs[index]?.workspace.workspaceTabId ??
					remainingTabs[index - 1]?.workspace.workspaceTabId ??
					null)
				: activeWorkspaceTabId;
		tabs = remainingTabs;
		activeWorkspaceTabId = nextActiveTabId;
		releaseVisualWorkspaceTab(tab);
		if (closingActiveTab) {
			await setActiveWorkspace(nextActiveTabId);
			return;
		}
		await persistWorkspaceTabs();
	}

	function reorderWorkspaceTab(workspaceTabId: string, beforeWorkspaceTabId: string | null) {
		const nextTabs = reorderWorkspaceTabs(tabs, workspaceTabId, beforeWorkspaceTabId);
		if (nextTabs.map((tab) => tab.workspace.workspaceTabId).join("\0") === tabs.map((tab) => tab.workspace.workspaceTabId).join("\0")) {
			return;
		}
		tabs = nextTabs;
		void persistWorkspaceTabs();
	}

	async function handleProviderAuthChanged(providerId: string) {
		await Promise.all(tabs.map((tab) => tab.runtime.syncProviderAuth(providerId)));
	}

	onMount(() => {
		setAppAppearance("system");
		void restoreWorkspaceTabs();

		return () => {
			disposed = true;
			disposeAppearanceSync?.();
			disposeAppearanceSync = null;
			for (const tab of tabs) {
				tab.unsubscribe();
				tab.runtime.dispose();
			}
			for (const retained of detachedRuntimes.values()) {
				retained.unsubscribe();
				retained.runtime.dispose();
			}
			detachedRuntimes.clear();
			tabs = [];
			activeWorkspaceTabId = null;
		};
	});
</script>

<HotkeysProvider defaultOptions={{ hotkey: { preventDefault: true, ignoreInputs: true } }}>
	<div class="app-shell">
		<div class="app-frame">
			<main class="workspace">
				<div class="workspace-body">
					{#if bootstrapError}
						<StatusCard
							tone="error"
							eyebrow="Runtime Error"
							title="Startup failed"
							message={bootstrapError}
						/>
					{:else if activeTab}
						{#key `${activeTab.workspace.workspaceTabId}:${activeTab.workspace.workspaceId}`}
							<ChatWorkspace
								runtime={activeTab.runtime}
								onProviderAuthChanged={handleProviderAuthChanged}
								onAppAppearanceChanged={setAppAppearance}
								workspaceTabs={workspaceTabItems}
								{activeWorkspaceTabId}
								{openingWorkspace}
								openWorkspaceError={activeOpenWorkspaceError}
								{knownWorkspaces}
								onSelectWorkspace={(workspaceTabId) => void setActiveWorkspace(workspaceTabId)}
								onCloseWorkspace={(workspaceTabId) => void closeWorkspaceTab(workspaceTabId)}
								onOpenWorkspace={() => void openWorkspace("current-tab")}
								onNewWorkspaceTab={() => void createDefaultWorkspaceTab()}
								onOpenWorkspaceInNewTab={() => void openWorkspace("new-tab")}
								onReorderWorkspace={reorderWorkspaceTab}
							/>
						{/key}
					{/if}
					{#if restoring && !bootstrapError}
						<StatusCard
							eyebrow="Boot Sequence"
							title="Starting svvy"
							message="Restoring open workspace tabs."
						/>
					{/if}
				</div>
			</main>
		</div>
	</div>
</HotkeysProvider>

<style>
	.app-shell {
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	.app-frame {
		display: grid;
		grid-template-rows: minmax(0, 1fr);
		height: 100%;
		min-height: 0;
		background: transparent;
		overflow: hidden;
	}

	.workspace {
		position: relative;
		display: grid;
		grid-template-rows: minmax(0, 1fr);
		--workspace-inset: 0.72rem;
		height: 100%;
		padding: 0;
		min-height: 0;
		overflow: hidden;
	}

	.workspace-body {
		display: grid;
		grid-template-rows: minmax(0, 1fr);
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	@media (max-width: 760px) {
		.workspace {
			--workspace-inset: 0rem;
		}
	}
</style>
