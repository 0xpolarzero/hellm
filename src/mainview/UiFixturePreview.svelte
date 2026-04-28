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

<main class="fixture-shell" aria-label="svvy UI fixture preview">
	<aside class="fixture-sidebar">
		<div class="fixture-brand">
			<span class="fixture-brand-mark">sv</span>
			<strong>svvy</strong>
		</div>
		<nav aria-label="Fixture sessions">
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
				</button>
			{/each}
		</nav>
	</aside>

	<section class="fixture-workbench">
		<PaneHeader eyebrow="Orchestrator" title="OAuth provider hardening">
			{#snippet meta()}
				<StatusBadge status="running">running</StatusBadge>
				<MetadataChip label="model" value="gpt-5.2" />
				<MetadataChip label="worktree" value="feature/auth" tone="info" />
			{/snippet}
			{#snippet actions()}
				<Button size="sm" variant="ghost">Inspector</Button>
			{/snippet}
		</PaneHeader>

		<div class="fixture-content">
			<section class="fixture-card">
				<SectionHeader title="Handler Threads" description="Dense rows share selected, hover, focus, disabled, and metadata behavior.">
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

			<section class="fixture-card">
				<SectionHeader title="Command Rollup">
					{#snippet actions()}
						<KeyboardHint keys={["Cmd", "Shift", "P"]} />
					{/snippet}
				</SectionHeader>
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
			</section>
		</div>
	</section>
</main>

<style>
	.fixture-shell {
		display: grid;
		grid-template-columns: 15rem minmax(0, 1fr);
		height: 100%;
		min-height: 0;
		background: var(--ui-bg);
		color: var(--ui-text-primary);
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

	.fixture-brand,
	.fixture-command {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.fixture-brand {
		gap: 0.5rem;
		height: 2.25rem;
		font-size: 0.82rem;
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

	.fixture-sidebar nav {
		display: grid;
		gap: 0.2rem;
		align-content: start;
		min-height: 0;
		overflow: auto;
	}

	.fixture-session {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.5rem;
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

	.fixture-command {
		gap: 0.45rem;
	}

	.fixture-content {
		display: grid;
		grid-template-columns: minmax(17rem, 1fr) minmax(16rem, 0.8fr);
		gap: var(--space-xs);
		min-height: 0;
		padding: var(--space-xs);
		overflow: auto;
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

		.fixture-brand strong,
		.fixture-session span:last-child {
			display: none;
		}

		.fixture-content {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
