<script lang="ts">
	import ContextBudgetBar from "./ContextBudgetBar.svelte";
	import Badge from "./ui/Badge.svelte";
	import Button from "./ui/Button.svelte";
	import DenseRow from "./ui/DenseRow.svelte";
	import Divider from "./ui/Divider.svelte";
	import KeyboardHint from "./ui/KeyboardHint.svelte";
	import MetadataChip from "./ui/MetadataChip.svelte";
	import PaneHeader from "./ui/PaneHeader.svelte";
	import SectionHeader from "./ui/SectionHeader.svelte";
	import StateMessage from "./ui/StateMessage.svelte";
	import StatusBadge from "./ui/StatusBadge.svelte";

	const sessions = [
		{
			title: "OAuth provider hardening",
			preview: "Handler is validating refresh-token edge cases.",
			status: "running",
			budget: {
				usedTokens: 42_000,
				maxTokens: 100_000,
				percent: 42,
				tone: "orange" as const,
				label: "42% context",
				detail: "42k of 100k tokens",
			},
		},
		{
			title: "Project CI projection",
			preview: "Checks passed and artifacts are ready for inspection.",
			status: "verified",
			budget: {
				usedTokens: 28_000,
				maxTokens: 100_000,
				percent: 28,
				tone: "neutral" as const,
				label: "28% context",
				detail: "28k of 100k tokens",
			},
		},
		{
			title: "Workflow approval",
			preview: "Waiting for package install approval from the owner.",
			status: "waiting",
			budget: {
				usedTokens: 63_000,
				maxTokens: 100_000,
				percent: 63,
				tone: "red" as const,
				label: "63% context",
				detail: "63k of 100k tokens",
			},
		},
	];

	const commands = [
		{ label: "thread.start", tone: "info" as const, detail: "delegated handler thread" },
		{ label: "smithers.run_workflow", tone: "warning" as const, detail: "workflow active" },
		{ label: "api.exec.run", tone: "success" as const, detail: "tests passed" },
	];
</script>

<main class="fixture-shell" aria-label="svvy shell chrome fixture preview">
	<header class="fixture-titlebar">
		<div class="fixture-titlebar-left">
			<span class="fixture-brand-mark">sv</span>
			<strong>svvy</strong>
			<MetadataChip label="workspace" value="svvy" />
			<MetadataChip label="branch" value="codex/ui-shell" tone="info" />
		</div>
		<div class="fixture-titlebar-actions">
			<KeyboardHint keys={["Cmd", "Shift", "P"]} />
			<Button size="sm" variant="ghost">Palette</Button>
			<Button size="sm" variant="ghost">Quick Open</Button>
		</div>
	</header>
	<aside class="fixture-sidebar">
		<div class="fixture-sidebar-header">
			<div>
				<p>Sessions</p>
				<h2>svvy</h2>
			</div>
			<Button size="sm" variant="ghost">New</Button>
		</div>
		<nav aria-label="Fixture sessions">
			<p class="fixture-section-label">Pinned</p>
			{#each sessions as session}
				<button class="fixture-session" class:active={session.status === "running"} type="button">
					<span
						class="status-dot"
						class:pulse-dot={session.status === "running"}
						data-status={session.status}
					></span>
					<span>
						<strong>{session.title}</strong>
						<small>{session.preview}</small>
					</span>
					<span class="fixture-pane-chip">{session.status === "running" ? "Left" : "Pane"}</span>
				</button>
			{/each}
			<button class="fixture-archive" type="button">Archived <span>4</span></button>
		</nav>
	</aside>

	<section class="fixture-workbench">
		<header class="fixture-workbench-header">
			<div>
				<p>Messaging orchestrator</p>
				<h1>OAuth provider hardening</h1>
			</div>
			<div class="fixture-workbench-meta">
				<StatusBadge status="running">running</StatusBadge>
				<MetadataChip label="target" value="orchestrator" />
				<MetadataChip label="model" value="gpt-5.2" />
				<MetadataChip label="reasoning" value="high" />
				<MetadataChip label="worktree" value="feature/auth" tone="info" />
				<Button size="sm" variant="ghost">Inspector</Button>
			</div>
		</header>

		<div class="fixture-content">
			<section class="fixture-pane active-pane">
				<PaneHeader eyebrow="Orchestrator" title="OAuth provider hardening">
					{#snippet meta()}
						<StatusBadge status="running">streaming</StatusBadge>
						<MetadataChip label="context" value="42%" tone="warning" />
					{/snippet}
					{#snippet actions()}
						<Button size="sm" variant="ghost">Split</Button>
						<Button size="sm" variant="ghost">Close</Button>
					{/snippet}
				</PaneHeader>
				<div class="fixture-pane-body">
					<section class="fixture-card">
						<SectionHeader title="Handler Threads">
							{#snippet actions()}
								<Badge tone="info">3 surfaces</Badge>
							{/snippet}
						</SectionHeader>
						{#each sessions as session}
							<DenseRow as="button" active={session.status === "running"} tone={session.status === "waiting" ? "warning" : session.status === "verified" ? "success" : "accent"}>
								{#snippet leading()}
									<span
										class="status-dot"
										class:pulse-dot={session.status === "running"}
										data-status={session.status}
									></span>
								{/snippet}
								<div class="fixture-thread-copy">
									<h3>{session.title}</h3>
									<p>{session.preview}</p>
								</div>
								{#snippet meta()}
									<MetadataChip
										value={session.budget.label}
										tone={session.budget.tone === "red" ? "danger" : session.budget.tone === "orange" ? "warning" : "neutral"}
									/>
								{/snippet}
								{#snippet actions()}
									<Button size="xs" variant="ghost">Open</Button>
								{/snippet}
								<ContextBudgetBar budget={session.budget} variant="compact" />
							</DenseRow>
						{/each}
					</section>
					<div class="fixture-composer">
						<span>@</span>
						<p>Ask svvy to inspect provider refresh handling</p>
						<MetadataChip label="target" value="orchestrator" />
						<Button size="sm">Send</Button>
					</div>
				</div>
			</section>

			<section class="fixture-pane">
				<PaneHeader eyebrow="Inspector" title="Command Rollup">
					{#snippet meta()}
						<MetadataChip label="surface" value="command" />
					{/snippet}
				</PaneHeader>
				<div class="fixture-card inspector-card">
					<SectionHeader title="Command Rollup" />
					{#each commands as command}
						<div class="fixture-command">
							<Badge tone={command.tone}>{command.label}</Badge>
							<span>{command.detail}</span>
						</div>
					{/each}
					<Divider />
					<StateMessage
						tone="loading"
						title="Workflow run streaming"
						description="Loading states use a compact row-safe treatment instead of a page-level spinner."
					/>
					<StateMessage
						tone="error"
						title="Provider missing"
						description="Error states share semantic danger tokens across panels and dialogs."
					/>
					<p class="fixture-stream">
						Streaming progress from the active surface<span class="stream-cursor"></span>
					</p>
					<div class="ui-loading-skeleton fixture-skeleton" aria-hidden="true"></div>
				</div>
			</section>
		</div>
	</section>
</main>

<style>
	.fixture-shell {
		display: grid;
		grid-template-columns: 15rem minmax(0, 1fr);
		grid-template-rows: 2rem minmax(0, 1fr);
		height: 100%;
		min-height: 0;
		background: var(--ui-bg);
		color: var(--ui-text-primary);
	}

	.fixture-titlebar {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
		min-width: 0;
		padding: 0 0.72rem;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-shell-edge) 64%, transparent);
		background: color-mix(in oklab, var(--ui-shell) 78%, transparent);
	}

	.fixture-titlebar-left,
	.fixture-titlebar-actions,
	.fixture-workbench-meta,
	.fixture-sidebar-header,
	.fixture-composer,
	.fixture-pane-chip,
	.fixture-archive {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.fixture-titlebar-left,
	.fixture-titlebar-actions,
	.fixture-workbench-meta {
		gap: 0.42rem;
	}

	.fixture-sidebar {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		gap: var(--space-xs);
		min-width: 0;
		padding: var(--space-xs);
		border-right: 1px solid var(--ui-shell-edge);
		background: var(--ui-shell);
	}

	.fixture-command {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.fixture-brand-mark {
		display: grid;
		place-items: center;
		width: 1.35rem;
		height: 1.35rem;
		border-radius: var(--ui-radius-md);
		background: var(--ui-accent-soft);
		color: var(--ui-accent);
		font-family: var(--font-mono);
		font-size: 0.6rem;
		font-weight: 700;
	}

	.fixture-sidebar-header {
		justify-content: space-between;
		gap: 0.65rem;
		padding-bottom: 0.72rem;
		border-bottom: 1px solid var(--ui-border-soft);
	}

	.fixture-sidebar-header p,
	.fixture-sidebar-header h2,
	.fixture-workbench-header p,
	.fixture-workbench-header h1 {
		margin: 0;
	}

	.fixture-sidebar-header p,
	.fixture-workbench-header p,
	.fixture-section-label {
		color: var(--ui-text-tertiary);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		text-transform: uppercase;
	}

	.fixture-sidebar-header h2,
	.fixture-workbench-header h1 {
		margin-top: 0.2rem;
		font-size: 0.92rem;
	}

	.fixture-sidebar nav {
		display: grid;
		gap: 0.2rem;
		align-content: start;
		min-height: 0;
		overflow: auto;
	}

	.fixture-section-label {
		margin: 0.1rem 0 0.24rem;
	}

	.fixture-session {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 0.5rem;
		align-items: center;
		width: 100%;
		min-height: 2.5rem;
		padding: 0.38rem 0.5rem;
		border: 1px solid transparent;
		border-left: 2px solid transparent;
		border-radius: var(--ui-radius-md);
		background: transparent;
		color: inherit;
		text-align: left;
	}

	.fixture-pane-chip {
		min-height: 1rem;
		padding: 0.08rem 0.34rem;
		border-radius: 999px;
		background: var(--ui-accent-soft);
		color: var(--ui-accent);
		font-family: var(--font-mono);
		font-size: 0.55rem;
	}

	.fixture-archive {
		justify-content: space-between;
		margin-top: 0.4rem;
		padding: 0.38rem 0.5rem;
		border: 1px solid transparent;
		border-radius: var(--ui-radius-md);
		background: transparent;
		color: var(--ui-text-tertiary);
		font-size: 0.68rem;
	}

	.fixture-session:hover,
	.fixture-session.active {
		border-color: var(--ui-border-soft);
		border-left-color: var(--ui-accent);
		background: var(--ui-surface-subtle);
	}

	.fixture-session strong,
	.fixture-session small {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.fixture-session strong {
		font-size: 0.76rem;
	}

	.fixture-session small {
		margin-top: 0.12rem;
		color: var(--ui-text-tertiary);
		font-size: 0.66rem;
	}

	.fixture-workbench {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		min-width: 0;
		min-height: 0;
	}

	.fixture-workbench-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		min-width: 0;
		min-height: 3.05rem;
		padding: 0.45rem 0.65rem;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-shell-edge) 62%, transparent);
		background: color-mix(in oklab, var(--ui-bg-elevated) 42%, transparent);
	}

	.fixture-command {
		gap: 0.45rem;
	}

	.fixture-content {
		display: grid;
		grid-template-columns: minmax(17rem, 1fr) minmax(16rem, 0.8fr);
		gap: var(--space-xs);
		min-height: 0;
		padding: var(--space-xs);
		overflow: hidden;
	}

	.fixture-pane {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		border: 1px solid var(--ui-border-soft);
		border-radius: var(--ui-radius-lg);
		background: color-mix(in oklab, var(--ui-shell) 88%, transparent);
	}

	.active-pane {
		border-color: color-mix(in oklab, var(--ui-accent) 44%, var(--ui-border-soft));
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--ui-accent) 14%, transparent);
	}

	.fixture-pane-body {
		display: grid;
		grid-template-rows: minmax(0, 1fr) auto;
		gap: var(--space-xs);
		min-height: 0;
		padding: var(--space-xs);
		overflow: hidden;
	}

	.fixture-card {
		display: grid;
		align-content: start;
		gap: 0.6rem;
		min-width: 0;
		min-height: 0;
		padding: var(--space-xs);
		border: 1px solid var(--ui-border-soft);
		border-radius: var(--ui-radius-lg);
		background: var(--ui-surface);
		box-shadow: var(--ui-shadow-soft);
	}

	.fixture-card :global(.context-budget-compact) {
		display: none;
	}

	.inspector-card {
		margin: var(--space-xs);
		overflow: auto;
	}

	.fixture-composer {
		justify-content: space-between;
		gap: 0.45rem;
		min-height: 2.6rem;
		padding: 0.44rem 0.5rem;
		border: 1px solid var(--ui-border-soft);
		border-radius: var(--ui-radius-lg);
		background: var(--ui-surface);
	}

	.fixture-composer p {
		flex: 1;
		min-width: 0;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ui-text-secondary);
		font-size: 0.72rem;
	}

	.fixture-thread-copy h3,
	.fixture-thread-copy p {
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.fixture-thread-copy h3 {
		font-size: 0.78rem;
	}

	.fixture-thread-copy p,
	.fixture-command,
	.fixture-stream {
		color: var(--ui-text-secondary);
		font-size: 0.72rem;
	}

	.fixture-command {
		justify-content: space-between;
		min-height: 2rem;
		border-top: 1px solid var(--ui-border-soft);
	}

	.fixture-stream {
		margin: 0.2rem 0 0;
		font-family: var(--font-mono);
	}

	.fixture-skeleton {
		width: min(18rem, 100%);
		height: 0.52rem;
	}

	@media (max-width: 760px) {
		.fixture-shell {
			grid-template-columns: 3.25rem minmax(0, 1fr);
		}

		.fixture-titlebar-left :global(.ui-metadata-chip),
		.fixture-titlebar-actions,
		.fixture-sidebar-header,
		.fixture-pane-chip,
		.fixture-session span:nth-child(2) {
			display: none;
		}

		.fixture-content {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
