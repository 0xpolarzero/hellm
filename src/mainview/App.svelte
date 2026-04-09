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
	<Surface tone="subtle" padding="none" class="topbar">
		<div>
			<p class="eyebrow">Desktop Bootstrap</p>
			<h1>hellm</h1>
			<p class="subtitle">Owned shell UI around the pi-backed desktop chat runtime.</p>
		</div>
		<div class="topbar-actions">
			<Button variant="primary" size="sm" onclick={() => (showSettings = true)} title="Provider settings">
				Providers
			</Button>
		</div>
	</Surface>

	<div class="workspace">
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
	</div>
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
		padding: 1rem;
		gap: 1rem;
	}

	:global(.topbar) {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.2rem;
	}

	.eyebrow {
		margin: 0 0 0.22rem;
		font-size: 0.72rem;
		font-weight: 760;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ui-accent-strong);
	}

	h1 {
		margin: 0;
		font-size: 1.48rem;
		font-weight: 760;
		letter-spacing: -0.03em;
		color: var(--ui-text-primary);
	}

	.subtitle {
		margin: 0.32rem 0 0;
		max-width: 36rem;
		font-size: 0.88rem;
		line-height: 1.55;
		color: var(--ui-text-secondary);
	}

	.topbar-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding-top: 0.12rem;
	}

	.workspace {
		position: relative;
		flex: 1;
		min-height: 0;
	}

	:global(.chat-area) {
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	@media (max-width: 720px) {
		.app-shell {
			padding: 0.75rem;
		}

		.workspace {
			min-height: 70vh;
		}

		:global(.topbar) {
			flex-direction: column;
			padding: 0.95rem;
		}

		.topbar-actions {
			width: 100%;
			justify-content: flex-start;
		}
	}
</style>
