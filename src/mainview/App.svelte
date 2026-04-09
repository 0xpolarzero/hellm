<script lang="ts">
	import { onMount } from "svelte";
	import ChatWorkspace from "./ChatWorkspace.svelte";
	import { createChatRuntime, type ChatRuntime } from "./chat-runtime";
	import Settings from "./Settings.svelte";
	import Button from "./ui/Button.svelte";
	import StatusCard from "./ui/StatusCard.svelte";
	import Surface from "./ui/Surface.svelte";

	let runtime = $state<ChatRuntime | null>(null);
	let bootstrapError = $state<string | null>(null);
	let showSettings = $state(false);
	let disposed = false;

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
	<header class="app-rail">
		<div class="brand">
			<span class="brand-mark" aria-hidden="true"></span>
			<div class="brand-copy">
				<h1>hellm</h1>
				<p>pi-backed desktop workbench</p>
			</div>
		</div>
		<div class="rail-actions">
			<Button variant="secondary" size="sm" onclick={() => (showSettings = true)} title="Provider settings">
				Provider Access
			</Button>
		</div>
	</header>

	<main class="workspace">
		<Surface tone="default" padding="none" class="chat-area">
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
		</Surface>
	</main>
</div>

{#if showSettings}
	<Settings onClose={() => (showSettings = false)} onProviderAuthChanged={handleProviderAuthChanged} />
{/if}

<style>
	.app-shell {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		width: 100%;
		padding: 0;
		gap: 0;
	}

	.app-rail {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.55rem 0.8rem;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.72rem;
		min-width: 0;
	}

	.brand-mark {
		inline-size: 0.9rem;
		block-size: 0.9rem;
		flex-shrink: 0;
		border-radius: 1px;
		background: var(--ui-accent);
	}

	h1 {
		margin: 0;
		font-size: 0.98rem;
		font-weight: 710;
		letter-spacing: -0.03em;
		line-height: 1;
		color: var(--ui-text-primary);
	}

	.brand-copy {
		min-width: 0;
	}

	.brand-copy p {
		margin: 0.16rem 0 0;
		font-size: 0.72rem;
		font-family: var(--font-mono);
		letter-spacing: 0.02em;
		color: var(--ui-text-secondary);
	}

	.rail-actions {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.workspace {
		display: flex;
		position: relative;
		flex: 1;
		min-height: 0;
	}

	:global(.chat-area) {
		height: 100%;
		min-height: 0;
		overflow: hidden;
		border: none;
		border-radius: 0;
		background: var(--ui-bg-elevated);
	}

	@media (max-width: 720px) {
		.workspace {
			min-height: 70vh;
		}

		.app-rail {
			padding-inline: 0.65rem;
		}
	}
</style>
