<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import Badge from "./Badge.svelte";

	type StatusKind =
		| "idle"
		| "active"
		| "running"
		| "streaming"
		| "retrying"
		| "success"
		| "done"
		| "verified"
		| "passed"
		| "connected"
		| "waiting"
		| "blocked"
		| "approval"
		| "failed"
		| "invalid"
		| "missing"
		| "disconnected"
		| "cancelled"
		| "info";

	type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

	type Props = HTMLAttributes<HTMLSpanElement> & {
		status?: StatusKind | string;
		tone?: StatusTone;
		live?: boolean;
		dot?: boolean;
		children?: Snippet;
	};

	let {
		status = "idle",
		tone,
		live,
		dot = true,
		class: className = "",
		children,
		...rest
	}: Props = $props();

	const runningStatuses = new Set(["active", "running", "streaming", "retrying"]);
	const successStatuses = new Set(["success", "done", "verified", "passed", "connected"]);
	const warningStatuses = new Set(["waiting", "blocked", "approval", "disconnected"]);
	const dangerStatuses = new Set(["failed", "invalid", "missing", "cancelled"]);

	function statusTone(statusValue: string): StatusTone {
		if (tone) return tone;
		if (runningStatuses.has(statusValue)) return "warning";
		if (successStatuses.has(statusValue)) return "success";
		if (warningStatuses.has(statusValue)) return "warning";
		if (dangerStatuses.has(statusValue)) return "danger";
		if (statusValue === "info") return "info";
		return "neutral";
	}

	const normalizedStatus = $derived(String(status).toLowerCase());
	const resolvedTone = $derived(statusTone(normalizedStatus));
	const isLive = $derived(live ?? runningStatuses.has(normalizedStatus));
</script>

<Badge {...rest} tone={resolvedTone} class={`ui-status-badge ${className}`.trim()}>
	{#if dot}
		<span
			class="status-dot"
			class:pulse-dot={isLive}
			data-status={normalizedStatus}
			aria-hidden="true"
		></span>
	{/if}
	<span class="ui-status-label">
		{#if children}
			{@render children()}
		{:else}
			{status}
		{/if}
	</span>
</Badge>

<style>
	:global(.ui-status-badge) {
		text-transform: none;
	}

	.ui-status-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
