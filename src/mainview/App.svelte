<script lang="ts">
	import { onMount } from "svelte";
	import ChatWorkspace from "./ChatWorkspace.svelte";
	import { createChatRuntime, type ChatRuntime } from "./chat-runtime";
	import Settings from "./Settings.svelte";
	import UiFixturePreview from "./UiFixturePreview.svelte";
	import StatusCard from "./ui/StatusCard.svelte";

	let runtime = $state<ChatRuntime | null>(null);
	let bootstrapError = $state<string | null>(null);
	let showSettings = $state(false);
	const fixturePreview = new URLSearchParams(window.location.search).has("ui-fixture");
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
				bootstrapError = error instanceof Error ? error.message : "Unable to initialize svvy.";
			}
		}
	}

	async function handleProviderAuthChanged(providerId: string) {
		await runtime?.syncProviderAuth(providerId);
	}

	onMount(() => {
		if (fixturePreview) {
			return;
		}

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
		<main class="workspace">
			<div class="workspace-body">
				{#if fixturePreview}
					<UiFixturePreview />
				{:else if bootstrapError}
					<StatusCard
						tone="error"
						eyebrow="Runtime Error"
						title="Startup failed"
						message={bootstrapError}
					/>
					{:else if runtime}
						<ChatWorkspace {runtime} onOpenSettings={() => (showSettings = true)} />
				{/if}
				{#if !fixturePreview && !runtime && !bootstrapError}
					<StatusCard
						eyebrow="Boot Sequence"
						title="Starting svvy"
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
