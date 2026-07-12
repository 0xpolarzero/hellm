<script lang="ts">
	import { onMount } from "svelte";
	import { HotkeysProvider } from "@tanstack/svelte-hotkeys";
	import ChatWorkspace from "./ChatWorkspace.svelte";
	import { createChatRuntime, type ChatRuntime } from "./chat-runtime";
	import { rpc } from "./rpc";
	import { applyAppAppearance } from "./theme";
	import StatusCard from "./ui/StatusCard.svelte";
	import type { WorkspaceTabStripItem } from "./WorkspaceTabStrip.svelte";
	import {
		mergeKnownWorkspaces,
		reorderWorkspaceTabs,
		summarizeWorkspaceTabCounts,
		type WorkspaceTabCounts,
	} from "./workspace-tabs";
	import type {
		WorkspaceChromeReadModel,
		WorkspaceInfoResponse,
		WorkspaceTabRecord,
		WorkspaceTabInfo,
	} from "../shared/workspace-contract";
	import type { AppAppearance } from "../shared/agent-settings";
	import type {
		RuntimeClientRequestId,
		RuntimeClientSubmissionSource,
	} from "@svvy/core";
	import { createWorkspaceChromeMutationQueue } from "./workspace-chrome-mutation-queue";

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

	type LocalWorkspaceChromeSnapshot = {
		tabs: OpenWorkspaceTab[];
		activeWorkspaceTabId: string | null;
		knownWorkspaces: WorkspaceTabInfo[];
		restoreErrorsByWorkspaceTabId: Record<string, string>;
	};

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
	let workspaceTabSelectionSequence = 0;
	const workspaceLayoutSelectionSequences = new Map<string, number>();
	const createWorkspaceTabId = () => `workspace-tab-${crypto.randomUUID()}`;
	let activeWorkspaceTabId = $state<string | null>(null);
	const workspaceChromeMutations = createWorkspaceChromeMutationQueue((mutation) => {
		switch (mutation.kind) {
			case "set-tabs":
				return rpc.request.stateWorkspaceChromeSetTabs(mutation.input);
			case "select-tab":
				return rpc.request.stateWorkspaceChromeSelectTab(mutation.input);
			case "select-layout-slot":
				return rpc.request.stateWorkspaceChromeSelectLayoutSlot(mutation.input);
		}
	});
	const activeTab = $derived(
		tabs.find((tab) => tab.workspace.workspaceTabId === activeWorkspaceTabId) ?? null,
	);
	const activeOpenWorkspaceError = $derived(
		openingError ??
			(activeWorkspaceTabId ? restoreErrorsByWorkspaceTabId[activeWorkspaceTabId] ?? null : null),
	);
	const workspaceTabItems = $derived<WorkspaceTabStripItem[]>(
		tabs.map((tab) => ({
			workspace: tab.workspace,
			counts:
				tab.workspace.workspaceTabId === activeWorkspaceTabId
					? { ...tab.counts, unread: 0 }
					: tab.counts,
		})),
	);

	function summarizeWorkspace(runtime: ChatRuntime): WorkspaceTabCounts {
		return summarizeWorkspaceTabCounts({
			sessions: runtime.sessions,
			appLogSummary: runtime.appLogSummary,
		});
	}

	function toWorkspaceTabInfo(
		workspace: WorkspaceInfoResponse | WorkspaceTabInfo | WorkspaceTabRecord,
		openedAt = new Date().toISOString(),
		workspaceTabId = "workspaceTabId" in workspace ? workspace.workspaceTabId : createWorkspaceTabId(),
		activeLayoutId = "activeLayoutId" in workspace ? workspace.activeLayoutId : "A",
	): WorkspaceTabInfo {
		return {
			...workspace,
			workspaceTabId,
			openedAt: "openedAt" in workspace ? workspace.openedAt : openedAt,
			activeLayoutId,
		};
	}

	function toWorkspaceTabRecord(workspace: WorkspaceTabInfo): WorkspaceTabRecord {
		return {
			workspaceTabId: workspace.workspaceTabId as WorkspaceTabRecord["workspaceTabId"],
			workspaceId: workspace.workspaceId as WorkspaceTabRecord["workspaceId"],
			cwd: workspace.cwd as WorkspaceTabRecord["cwd"],
			workspaceLabel: workspace.workspaceLabel,
			kind: workspace.kind,
			openedAt: workspace.openedAt as WorkspaceTabRecord["openedAt"],
			activeLayoutId: workspace.activeLayoutId,
		};
	}

	function desktopClientSubmission() {
		return {
			clientRequestId: `desktop-${crypto.randomUUID()}` as RuntimeClientRequestId,
			source: "desktop" as RuntimeClientSubmissionSource,
		};
	}

	function applyAuthoritativeWorkspaceChrome(readModel: WorkspaceChromeReadModel): void {
		const localTabsById = new Map(
			tabs.map((tab) => [tab.workspace.workspaceTabId, tab] as const),
		);
		const authoritativeTabs = readModel.tabs.flatMap((workspace) => {
			const tab = localTabsById.get(workspace.workspaceTabId);
			if (!tab) return [];
			tab.workspace = {
				...tab.workspace,
				...toWorkspaceTabInfo(workspace),
				branch: tab.workspace.branch,
			};
			return [tab];
		});
		const authoritativeIds = new Set(readModel.tabs.map((tab) => tab.workspaceTabId));
		tabs = [
			...authoritativeTabs,
			...tabs.filter((tab) => !authoritativeIds.has(tab.workspace.workspaceTabId)),
		];
		activeWorkspaceTabId = readModel.activeWorkspaceTabId;
		knownWorkspaces = readModel.knownWorkspaces.map((workspace) =>
			toWorkspaceTabInfo(workspace),
		);
	}

	function captureLocalWorkspaceChrome(): LocalWorkspaceChromeSnapshot {
		return {
			tabs: [...tabs],
			activeWorkspaceTabId,
			knownWorkspaces: [...knownWorkspaces],
			restoreErrorsByWorkspaceTabId: { ...restoreErrorsByWorkspaceTabId },
		};
	}

	function restoreLocalWorkspaceChrome(snapshot: LocalWorkspaceChromeSnapshot): void {
		tabs = snapshot.tabs;
		activeWorkspaceTabId = snapshot.activeWorkspaceTabId;
		knownWorkspaces = snapshot.knownWorkspaces;
		restoreErrorsByWorkspaceTabId = snapshot.restoreErrorsByWorkspaceTabId;
	}

	function workspaceTabRecordsStructurallyMatch(
		left: readonly WorkspaceTabRecord[],
		right: readonly WorkspaceTabRecord[],
	): boolean {
		return (
			left.length === right.length &&
			left.every((record, index) => {
				const other = right[index];
				return (
					other !== undefined &&
					record.workspaceTabId === other.workspaceTabId &&
					record.workspaceId === other.workspaceId &&
					record.cwd === other.cwd &&
					record.workspaceLabel === other.workspaceLabel &&
					record.kind === other.kind &&
					record.openedAt === other.openedAt
				);
			})
		);
	}

	function workspaceChromeStructurallyMatches(
		readModel: WorkspaceChromeReadModel,
		input: Parameters<typeof rpc.request.stateWorkspaceChromeSetTabs>[0],
	): boolean {
		return (
			readModel.activeWorkspaceTabId === input.activeWorkspaceTabId &&
			workspaceTabRecordsStructurallyMatch(readModel.tabs, input.tabs) &&
			workspaceTabRecordsStructurallyMatch(readModel.knownWorkspaces, input.knownWorkspaces)
		);
	}

	async function refetchAuthoritativeWorkspaceChrome(): Promise<void> {
		const result = await rpc.request.fetchStateReadModel({ kind: "workspaceChrome" });
		if (result.kind !== "workspaceChrome") {
			throw new Error(`Expected workspaceChrome; received ${result.kind}.`);
		}
		applyAuthoritativeWorkspaceChrome(result.value);
	}

	async function selectWorkspaceLayoutSlot(
		workspaceTabId: string,
		layoutId: WorkspaceTabInfo["activeLayoutId"],
	): Promise<void> {
		const tab = tabs.find((candidate) => candidate.workspace.workspaceTabId === workspaceTabId);
		const previousLayoutId = tab?.workspace.activeLayoutId;
		const selectionSequence = (workspaceLayoutSelectionSequences.get(workspaceTabId) ?? 0) + 1;
		workspaceLayoutSelectionSequences.set(workspaceTabId, selectionSequence);
		if (tab) {
			tab.workspace.activeLayoutId = layoutId;
			tabs = [...tabs];
		}
		const input = {
			workspaceTabId: workspaceTabId as WorkspaceTabRecord["workspaceTabId"],
			layoutId,
			clientSubmission: desktopClientSubmission(),
		};
		let reconciledAuthoritatively = false;
		try {
			await workspaceChromeMutations.enqueue(
				{ kind: "select-layout-slot", input },
				async () => {
					await refetchAuthoritativeWorkspaceChrome();
					reconciledAuthoritatively = true;
				},
			);
			if (workspaceLayoutSelectionSequences.get(workspaceTabId) === selectionSequence) {
				const selectedTab = tabs.find(
					(candidate) => candidate.workspace.workspaceTabId === workspaceTabId,
				);
				if (selectedTab) {
					selectedTab.workspace.activeLayoutId = layoutId;
					tabs = [...tabs];
				}
			}
		} catch (error) {
			if (
				!reconciledAuthoritatively &&
				previousLayoutId &&
				workspaceLayoutSelectionSequences.get(workspaceTabId) === selectionSequence
			) {
				const selectedTab = tabs.find(
					(candidate) => candidate.workspace.workspaceTabId === workspaceTabId,
				);
				if (selectedTab) {
					selectedTab.workspace.activeLayoutId = previousLayoutId;
					tabs = [...tabs];
				}
			}
			throw error;
		}
	}

	async function persistWorkspaceTabs() {
		const openTabs = tabs.map((tab) => tab.workspace);
		knownWorkspaces = mergeKnownWorkspaces(knownWorkspaces, openTabs, createWorkspaceTabId);
		const input = {
			activeWorkspaceTabId: activeWorkspaceTabId as WorkspaceTabRecord["workspaceTabId"] | null,
			tabs: openTabs.map(toWorkspaceTabRecord),
			knownWorkspaces: knownWorkspaces.map(toWorkspaceTabRecord),
			clientSubmission: desktopClientSubmission(),
		};
		try {
			await workspaceChromeMutations.enqueue({ kind: "set-tabs", input });
		} catch (error) {
			const result = await rpc.request.fetchStateReadModel({ kind: "workspaceChrome" }).catch(() => null);
			if (
				result?.kind === "workspaceChrome" &&
				workspaceChromeStructurallyMatches(result.value, input)
			) {
				applyAuthoritativeWorkspaceChrome(result.value);
				return;
			}
			throw error;
		}
	}

	function setAppAppearance(appearance: AppAppearance) {
		disposeAppearanceSync?.();
		disposeAppearanceSync = applyAppAppearance(appearance);
	}

	async function refreshAppAppearance() {
		try {
			const result = await rpc.request.fetchStateReadModel({ kind: "appPreferences" });
			if (result.kind !== "appPreferences") {
				throw new Error(`Expected appPreferences; received ${result.kind}.`);
			}
			setAppAppearance(result.value.appearance);
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
				awaitWorkspaceChromeMutations: () => workspaceChromeMutations.drain(),
				selectWorkspaceLayoutSlot: (layoutId) =>
					workspaceChromeMutations.runTracked(() =>
						selectWorkspaceLayoutSlot(workspaceTab.workspaceTabId, layoutId),
					),
			},
		);
		tab = {
			workspace: workspaceTab,
			runtime,
			counts: summarizeWorkspace(runtime),
			unsubscribe: () => {},
		};
		const unsubscribe = runtime.subscribe(() => {
			if (tab.workspace.activeLayoutId !== runtime.activeLayoutId) {
				tab.workspace.activeLayoutId = runtime.activeLayoutId;
			}
			tab.counts = summarizeWorkspace(runtime);
			tabs = [...tabs];
		});
		tab.unsubscribe = unsubscribe;
		return tab;
	}

	async function selectWorkspaceTab(workspaceTabId: string | null, tabsChanged = false) {
		const previousWorkspaceTabId = activeWorkspaceTabId;
		const selectionSequence = ++workspaceTabSelectionSequence;
		activeWorkspaceTabId = workspaceTabId;
		const tab = tabs.find((candidate) => candidate.workspace.workspaceTabId === workspaceTabId) ?? null;
		if (!tab) {
			await persistWorkspaceTabs();
			return;
		}
		if (tabsChanged) {
			await persistWorkspaceTabs();
		} else {
			const input = {
				workspaceTabId: workspaceTabId as WorkspaceTabRecord["workspaceTabId"],
				clientSubmission: desktopClientSubmission(),
			};
			let reconciledAuthoritatively = false;
			try {
				await workspaceChromeMutations.enqueue(
					{ kind: "select-tab", input },
					async () => {
						await refetchAuthoritativeWorkspaceChrome();
						reconciledAuthoritatively = true;
					},
				);
				if (workspaceTabSelectionSequence === selectionSequence) {
					activeWorkspaceTabId = workspaceTabId;
				}
			} catch (error) {
				if (!reconciledAuthoritatively && workspaceTabSelectionSequence === selectionSequence) {
					activeWorkspaceTabId = previousWorkspaceTabId;
				}
				throw error;
			}
		}
		await refreshAppAppearance();
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
			const restoreResult = await rpc.request.fetchStateReadModel({ kind: "workspaceChrome" }).catch((error) => {
				console.error("Failed to load app workspace tabs:", error);
				return null;
			});
			const restoreState = restoreResult?.kind === "workspaceChrome" ? restoreResult.value : null;
			knownWorkspaces = (restoreState?.knownWorkspaces ?? []).map((workspace) =>
				toWorkspaceTabInfo(workspace),
			);
			const tabsToRestore = restoreState?.tabs.length ? restoreState.tabs : [];
			knownWorkspaces = mergeKnownWorkspaces(
				knownWorkspaces,
				tabsToRestore.map((workspace) => toWorkspaceTabInfo(workspace)),
				createWorkspaceTabId,
			);

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
					restoredTabs.push(await createWorkspaceTab(toWorkspaceTabInfo(workspaceInfo, savedTab.openedAt, savedTab.workspaceTabId, savedTab.activeLayoutId), savedTab.workspaceTabId));
				} catch (error) {
					if (savedTab.kind === "default") throw error;
					console.error("Failed to restore workspace tab:", error);
					const reason = error instanceof Error ? error.message : "Unable to open workspace.";
					restoreErrorsByWorkspaceTabId = {
						...restoreErrorsByWorkspaceTabId,
						[savedTab.workspaceTabId]: `Unable to restore ${savedTab.workspaceLabel}: ${reason}`,
					};
					const fallback = await rpc.request.getDefaultWorkspace();
					restoredTabs.push(await createWorkspaceTab(toWorkspaceTabInfo(fallback, savedTab.openedAt, savedTab.workspaceTabId, savedTab.activeLayoutId), savedTab.workspaceTabId));
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
				createWorkspaceTabId,
			);
			const savedActiveIndex = restoreState?.activeWorkspaceTabId
				? tabsToRestore.findIndex((tab) => tab.workspaceTabId === restoreState.activeWorkspaceTabId)
				: -1;
			const restoredActive =
				savedActiveIndex >= 0
					? (tabs[savedActiveIndex]?.workspace.workspaceTabId ?? tabs[0]?.workspace.workspaceTabId ?? null)
					: (tabs[0]?.workspace.workspaceTabId ?? null);
			await selectWorkspaceTab(restoredActive, true);
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
				? knownWorkspaces.find(
						(workspace) =>
							(workspace.cwd.trim() || workspace.workspaceId) ===
							(workspaceInfo.cwd.trim() || workspaceInfo.workspaceId),
					)
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
			const previousChrome = captureLocalWorkspaceChrome();
			knownWorkspaces = mergeKnownWorkspaces(
				knownWorkspaces,
				[tab.workspace],
				createWorkspaceTabId,
			);
			const { [tab.workspace.workspaceTabId]: _clearedRestoreError, ...remainingRestoreErrors } =
				restoreErrorsByWorkspaceTabId;
			restoreErrorsByWorkspaceTabId = remainingRestoreErrors;
			let replacedTab: OpenWorkspaceTab | null = null;
			if (placement === "new-tab" || !activeWorkspaceTabId) {
				const activeIndex = tabs.findIndex((candidate) => candidate.workspace.workspaceTabId === activeWorkspaceTabId);
				tabs = [
					...tabs.slice(0, activeIndex + 1),
					tab,
					...tabs.slice(activeIndex + 1),
				];
			} else {
				replacedTab = tabs.find((candidate) => candidate.workspace.workspaceTabId === activeWorkspaceTabId) ?? null;
				tabs = tabs.map((candidate) =>
					candidate.workspace.workspaceTabId === activeWorkspaceTabId ? tab : candidate,
				);
			}
			try {
				await selectWorkspaceTab(tab.workspace.workspaceTabId, true);
			} catch (error) {
				restoreLocalWorkspaceChrome(previousChrome);
				releaseVisualWorkspaceTab(tab);
				throw error;
			}
			if (replacedTab) releaseVisualWorkspaceTab(replacedTab);
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
		const previousChrome = captureLocalWorkspaceChrome();
		const activeIndex = tabs.findIndex((candidate) => candidate.workspace.workspaceTabId === activeWorkspaceTabId);
		tabs = [
			...tabs.slice(0, activeIndex + 1),
			tab,
			...tabs.slice(activeIndex + 1),
		];
		try {
			await selectWorkspaceTab(tab.workspace.workspaceTabId, true);
		} catch (error) {
			restoreLocalWorkspaceChrome(previousChrome);
			releaseVisualWorkspaceTab(tab);
			throw error;
		}
	}

	async function closeWorkspaceTab(workspaceTabId: string) {
		const tab = tabs.find((candidate) => candidate.workspace.workspaceTabId === workspaceTabId);
		if (!tab) return;
		const { [workspaceTabId]: _clearedRestoreError, ...remainingRestoreErrors } =
			restoreErrorsByWorkspaceTabId;
		const previousChrome = captureLocalWorkspaceChrome();
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
			try {
				await selectWorkspaceTab(replacementTab.workspace.workspaceTabId, true);
			} catch (error) {
				restoreLocalWorkspaceChrome(previousChrome);
				releaseVisualWorkspaceTab(replacementTab);
				throw error;
			}
			releaseVisualWorkspaceTab(tab);
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
		try {
			if (closingActiveTab) {
				await selectWorkspaceTab(nextActiveTabId, true);
			} else {
				await persistWorkspaceTabs();
			}
		} catch (error) {
			restoreLocalWorkspaceChrome(previousChrome);
			throw error;
		}
		releaseVisualWorkspaceTab(tab);
	}

	function reorderWorkspaceTab(workspaceTabId: string, beforeWorkspaceTabId: string | null) {
		const nextTabs = reorderWorkspaceTabs(tabs, workspaceTabId, beforeWorkspaceTabId);
		if (nextTabs.map((tab) => tab.workspace.workspaceTabId).join("\0") === tabs.map((tab) => tab.workspace.workspaceTabId).join("\0")) {
			return;
		}
		const previousChrome = captureLocalWorkspaceChrome();
		tabs = nextTabs;
		void workspaceChromeMutations.runTracked(async () => {
			try {
				await persistWorkspaceTabs();
			} catch (error) {
				restoreLocalWorkspaceChrome(previousChrome);
				console.error("Failed to persist reordered workspace tabs:", error);
			}
		});
	}

	onMount(() => {
		setAppAppearance("system");
		void workspaceChromeMutations.runTracked(restoreWorkspaceTabs);

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
								onAppAppearanceChanged={setAppAppearance}
								workspaceTabs={workspaceTabItems}
								{activeWorkspaceTabId}
								{openingWorkspace}
								openWorkspaceError={activeOpenWorkspaceError}
								{knownWorkspaces}
								onSelectWorkspace={(workspaceTabId) => void workspaceChromeMutations.runTracked(() => selectWorkspaceTab(workspaceTabId)).catch((error) => console.error("Failed to select workspace tab:", error))}
								onCloseWorkspace={(workspaceTabId) => void workspaceChromeMutations.runTracked(() => closeWorkspaceTab(workspaceTabId)).catch((error) => console.error("Failed to close workspace tab:", error))}
								onOpenWorkspace={() => void workspaceChromeMutations.runTracked(() => openWorkspace("current-tab"))}
								onNewWorkspaceTab={() => void workspaceChromeMutations.runTracked(createDefaultWorkspaceTab).catch((error) => console.error("Failed to create workspace tab:", error))}
								onOpenWorkspaceInNewTab={() => void workspaceChromeMutations.runTracked(() => openWorkspace("new-tab"))}
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
