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
	<header class="app-header">
		<div class="app-copy">
			<p class="eyebrow">Pi-Backed Desktop Workbench</p>
			<div class="title-row">
				<h1>hellm</h1>
				<span class="title-mark" aria-hidden="true"></span>
			</div>
			<p class="subtitle">
				A focused renderer for orchestrated coding work on top of the pi runtime, with model control,
				provider access, transcript flow, and artifacts in one deliberate surface.
			</p>
		</div>
		<div class="header-rail">
			<div class="header-note">
				<p class="note-label">Design Direction</p>
				<p class="note-copy">Sleek, practical, confident. Strong hierarchy, faster scanning, sharper mobile adaptation.</p>
			</div>
			<Button variant="primary" size="sm" onclick={() => (showSettings = true)} title="Provider settings">
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
		padding: clamp(1rem, 2vw, 1.7rem);
		gap: clamp(1rem, 1vw + 0.7rem, 1.6rem);
	}

	.app-header {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(18rem, 0.86fr);
		gap: clamp(1rem, 2vw, 2rem);
		align-items: end;
	}

	.eyebrow {
		margin: 0 0 0.28rem;
		font-size: 0.72rem;
		font-weight: 760;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: color-mix(in oklab, var(--ui-accent-strong) 86%, var(--ui-text-primary));
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 0.9rem;
	}

	h1 {
		margin: 0;
		font-size: clamp(2.5rem, 5vw, 4.6rem);
		font-weight: 740;
		letter-spacing: -0.055em;
		line-height: 0.96;
		color: var(--ui-text-primary);
	}

	.title-mark {
		inline-size: clamp(1.6rem, 2vw, 2.1rem);
		block-size: clamp(1.6rem, 2vw, 2.1rem);
		border-radius: 0.46rem;
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-accent) 88%, white 12%), var(--ui-accent-strong));
		box-shadow:
			inset 0 1px 0 color-mix(in oklab, white 38%, transparent),
			0 14px 28px color-mix(in oklab, var(--ui-accent-strong) 24%, transparent);
		transform: translateY(0.18rem) rotate(8deg);
	}

	.subtitle {
		margin: 0.85rem 0 0;
		max-width: 50rem;
		font-size: clamp(0.96rem, 0.35vw + 0.88rem, 1.08rem);
		line-height: 1.65;
		color: var(--ui-text-secondary);
	}

	.header-rail {
		display: grid;
		gap: 0.8rem;
		justify-items: end;
	}

	.header-note {
		inline-size: min(100%, 24rem);
		padding: 0.9rem 0 0 1rem;
		border-left: 2px solid color-mix(in oklab, var(--ui-accent) 72%, var(--ui-border-strong));
	}

	.note-label,
	.note-copy {
		margin: 0;
	}

	.note-label {
		font-size: 0.68rem;
		font-weight: 760;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ui-accent-strong);
	}

	.note-copy {
		margin-top: 0.42rem;
		font-size: 0.88rem;
		line-height: 1.55;
		color: var(--ui-text-secondary);
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
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-bg-elevated) 96%, transparent), var(--ui-surface));
	}

	@media (max-width: 920px) {
		.app-header {
			grid-template-columns: 1fr;
			align-items: start;
		}

		.header-rail {
			justify-items: start;
		}
	}

	@media (max-width: 720px) {
		.app-shell {
			padding: 0.8rem;
		}

		.workspace {
			min-height: 70vh;
		}

		h1 {
			font-size: clamp(2.15rem, 12vw, 3.3rem);
		}

		.title-row {
			align-items: flex-end;
		}
	}
</style>
