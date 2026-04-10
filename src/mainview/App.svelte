<script lang="ts">
	import { onMount } from "svelte";
	import ChatWorkspace from "./ChatWorkspace.svelte";
	import { createChatRuntime, type ChatRuntime } from "./chat-runtime";
	import Settings from "./Settings.svelte";
	import StatusCard from "./ui/StatusCard.svelte";

	let runtime = $state<ChatRuntime | null>(null);
	let bootstrapError = $state<string | null>(null);
	let showSettings = $state(false);
	let disposed = false;

	const appStatusText = $derived(bootstrapError ? "Needs attention" : runtime ? "Runtime online" : "Booting");
	const appStatusCopy = $derived(
		bootstrapError
			? "The Bun-side runtime hit an initialization error."
			: runtime
				? "pi-backed orchestration is live and ready for session work."
				: "Initializing the pi host, session substrate, and desktop renderer.",
	);

	async function bootstrap() {
		try {
			const nextRuntime = await createChatRuntime({
				onMissingProviderAccess: () => {
					showSettings = true;
				},
			});
			if (disposed) {
				nextRuntime.dispose();
				return;
			}

			runtime = nextRuntime;
			bootstrapError = null;
		} catch (error) {
			if (!disposed) {
				bootstrapError = error instanceof Error ? error.message : "Unable to initialize hellm.";
			}
		}
	}

	async function handleProviderAuthChanged(providerId: string) {
		await runtime?.syncProviderAuth(providerId);
	}

	onMount(() => {
		void bootstrap();

		return () => {
			disposed = true;
			runtime?.dispose();
			runtime = null;
		};
	});
</script>

<div class="app-shell">
	<div class="app-frame">
		<header class="app-rail">
			<div class="brand">
				<span class="brand-mark" aria-hidden="true"></span>
				<div class="brand-copy">
					<p class="brand-kicker">Electrobun Desktop</p>
					<h1>hellm</h1>
				</div>
			</div>

			<div class="rail-status" aria-live="polite">
				<p class="rail-status-label">{appStatusText}</p>
				<p class="rail-status-copy">{appStatusCopy}</p>
			</div>

			<div class="rail-actions">
				<button class="settings-trigger" type="button" aria-label="Open settings" title="Settings" onclick={() => (showSettings = true)}>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path
							d="M6.52 1.39a1 1 0 0 1 1.96 0l.18 1.08c.23.08.45.17.66.28l.95-.55a1 1 0 0 1 1.34.37l.98 1.69a1 1 0 0 1-.37 1.35l-.95.55c.02.12.03.25.03.38s-.01.26-.03.38l.95.55a1 1 0 0 1 .37 1.35l-.98 1.69a1 1 0 0 1-1.34.37l-.95-.55c-.21.11-.43.2-.66.28l-.18 1.08a1 1 0 0 1-1.96 0l-.18-1.08a4.78 4.78 0 0 1-.66-.28l-.95.55a1 1 0 0 1-1.34-.37l-.98-1.69a1 1 0 0 1 .37-1.35l.95-.55A3.3 3.3 0 0 1 4.3 8c0-.13.01-.26.03-.38l-.95-.55a1 1 0 0 1-.37-1.35l.98-1.69a1 1 0 0 1 1.34-.37l.95.55c.21-.11.43-.2.66-.28l.18-1.08ZM8 10.12A2.12 2.12 0 1 0 8 5.88a2.12 2.12 0 0 0 0 4.24Z"
							fill="currentColor"
						/>
					</svg>
				</button>
			</div>
		</header>

		<main class="workspace">
			<div class="workspace-body">
				{#if bootstrapError}
					<StatusCard
						tone="error"
						eyebrow="Runtime Error"
						title="Startup failed"
						message={bootstrapError}
					/>
					{:else if runtime}
						<ChatWorkspace {runtime} />
				{/if}
				{#if !runtime && !bootstrapError}
					<StatusCard
						eyebrow="Boot Sequence"
						title="Starting hellm"
						message="Booting the Bun-side pi host and initializing the desktop chat surface."
					/>
				{/if}
			</div>
		</main>
	</div>
</div>

{#if showSettings}
	<Settings onClose={() => (showSettings = false)} onProviderAuthChanged={handleProviderAuthChanged} />
{/if}

<style>
	.app-shell {
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	.app-frame {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		height: 100%;
		min-height: 0;
		background: transparent;
		overflow: hidden;
	}

	.app-rail {
		display: grid;
		grid-template-columns: minmax(0, auto) minmax(0, 1fr) auto;
		align-items: center;
		gap: 1rem 1.4rem;
		padding: 1rem 1.2rem 0.85rem;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-shell-edge) 72%, transparent);
		background: linear-gradient(180deg, color-mix(in oklab, var(--ui-bg-elevated) 62%, transparent), transparent);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		min-width: 0;
	}

	.brand-mark {
		inline-size: 0.95rem;
		block-size: 0.95rem;
		flex-shrink: 0;
		border-radius: 0.3rem;
		background:
			linear-gradient(180deg, color-mix(in oklab, white 18%, var(--ui-accent)), var(--ui-accent-strong));
		box-shadow:
			0 0 0 1px color-mix(in oklab, var(--ui-accent) 28%, white),
			0 10px 24px -14px color-mix(in oklab, var(--ui-accent) 70%, transparent);
	}

	.brand-kicker {
		margin: 0 0 0.18rem;
		font-size: 0.68rem;
		font-family: var(--font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ui-text-tertiary);
	}

	h1 {
		margin: 0;
		font-size: 1.08rem;
		font-weight: 690;
		letter-spacing: -0.03em;
		line-height: 1;
		color: var(--ui-text-primary);
	}

	.brand-copy,
	.rail-status {
		min-width: 0;
	}

	.rail-status {
		display: grid;
		gap: 0.12rem;
		padding-left: 1rem;
		border-left: 1px solid color-mix(in oklab, var(--ui-shell-edge) 58%, transparent);
	}

	.rail-status-label,
	.rail-status-copy {
		margin: 0;
	}

	.rail-status-label {
		font-size: 0.75rem;
		font-weight: 650;
		letter-spacing: -0.01em;
		color: var(--ui-text-primary);
	}

	.rail-status-copy {
		font-size: 0.76rem;
		line-height: 1.5;
		color: var(--ui-text-secondary);
	}

	.rail-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.65rem;
	}

	.settings-trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 2rem;
		block-size: 2rem;
		padding: 0;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: var(--ui-radius-md);
		background: color-mix(in oklab, var(--ui-surface-raised) 84%, transparent);
		color: var(--ui-text-secondary);
		box-shadow: var(--ui-shadow-soft);
		cursor: pointer;
		transition:
			border-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			box-shadow 170ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.settings-trigger:hover {
		border-color: color-mix(in oklab, var(--ui-border-strong) 76%, transparent);
		background: color-mix(in oklab, var(--ui-surface) 82%, transparent);
		color: var(--ui-text-primary);
	}

	.settings-trigger:focus-visible {
		outline: none;
		box-shadow: var(--ui-focus-ring);
	}

	.settings-trigger svg {
		inline-size: 0.95rem;
		block-size: 0.95rem;
	}

	.workspace {
		position: relative;
		padding: 0.7rem;
		min-height: 0;
		overflow: hidden;
	}

	.workspace-body {
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	@media (max-width: 920px) {
		.app-rail {
			grid-template-columns: 1fr;
			align-items: start;
		}

		.rail-status {
			padding-left: 0;
			border-left: none;
		}

		.rail-actions {
			justify-content: flex-start;
		}
	}

	@media (max-width: 760px) {
		.workspace {
			padding: 0;
		}

		.app-rail {
			padding: 0.9rem 0.9rem 0.8rem;
		}

	}
</style>
