<script lang="ts">
	import { tick } from "svelte";
	import { katex } from "@mdit/plugin-katex";
	// oxlint-disable-next-line import/no-unassigned-import
	import "katex/dist/katex.min.css";
	import MarkdownIt from "markdown-it";
	import type Token from "markdown-it/lib/token.mjs";
	import abbr from "markdown-it-abbr";
	import deflist from "markdown-it-deflist";
	import footnote from "markdown-it-footnote";
	import taskLists from "markdown-it-task-lists";
	import { rpc } from "./rpc";

	type Props = {
		content: string;
		isFinished: boolean;
	};

	type ParsedMarkdown = {
		tokens: Token[];
		codeBlocks: Array<{ text: string; lang?: string }>;
	};

	let { content, isFinished }: Props = $props();

	let highlightedCode = $state<Record<string, string>>({});
	let containerElement = $state<HTMLDivElement | null>(null);
	let activeColorTheme = $state<"light" | "dark">("dark");
	let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
	let mermaidRenderCounter = 0;

	let markdown: MarkdownIt;
	let codeToHighlightedHtmlPromise:
		| Promise<(code: string, lang: HighlightLanguage, theme: "light" | "dark") => Promise<string>>
		| undefined;
	const parsedMarkdownCache = new Map<string, ParsedMarkdown>();
	const parsedMarkdownCacheLimit = 200;

	const supportedHighlightLanguages = [
		"bash",
		"css",
		"diff",
		"go",
		"html",
		"javascript",
		"json",
		"jsx",
		"markdown",
		"python",
		"rust",
		"svelte",
		"text",
		"toml",
		"tsx",
		"typescript",
		"yaml",
	] as const;
	type HighlightLanguage = (typeof supportedHighlightLanguages)[number];
	const supportedHighlightLanguageSet = new Set<string>(supportedHighlightLanguages);

	function escapeHtml(value: string) {
		return value
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#39;");
	}

	function codeKey(text: string, lang: string | undefined, theme: "light" | "dark") {
		return `${theme}\u0000${lang ?? "text"}\u0000${text}`;
	}

	function readColorTheme(): "light" | "dark" {
		return document.documentElement.dataset.theme === "light" ? "light" : "dark";
	}

	function mermaidColorVariable(name: string) {
		const cssColor = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		const canvas = document.createElement("canvas");
		canvas.width = 1;
		canvas.height = 1;
		const context = canvas.getContext("2d");
		if (!context) return cssColor;
		context.fillStyle = cssColor;
		context.fillRect(0, 0, 1, 1);
		const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
		return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
	}

	function normalizeLanguage(lang: string | undefined) {
		const normalized = lang?.trim().toLowerCase() ?? "";
		if (!normalized) return "text";
		if (normalized === "sh" || normalized === "shell") return "bash";
		if (normalized === "md") return "markdown";
		if (normalized === "ts") return "typescript";
		if (normalized === "js") return "javascript";
		return normalized;
	}

	function toHighlightLanguage(lang: string): HighlightLanguage {
		return supportedHighlightLanguageSet.has(lang) ? (lang as HighlightLanguage) : "text";
	}

	function rememberParsedMarkdown(key: string, parsed: ParsedMarkdown) {
		parsedMarkdownCache.delete(key);
		parsedMarkdownCache.set(key, parsed);
		while (parsedMarkdownCache.size > parsedMarkdownCacheLimit) {
			const oldestKey = parsedMarkdownCache.keys().next().value;
			if (!oldestKey) return;
			parsedMarkdownCache.delete(oldestKey);
		}
	}

	function getParsedMarkdown(source: string): ParsedMarkdown {
		const cached = parsedMarkdownCache.get(source);
		if (cached) {
			parsedMarkdownCache.delete(source);
			parsedMarkdownCache.set(source, cached);
			return cached;
		}

		const tokens = markdown.parse(source, {});
		const codeBlocks: Array<{ text: string; lang?: string }> = [];

		function collectCodeBlocks(items: Token[]) {
			for (const item of items) {
				if (item.type === "fence" || item.type === "code_block") {
					codeBlocks.push({ text: item.content, lang: item.info });
				}
				if (Array.isArray(item.children)) collectCodeBlocks(item.children);
			}
		}

		collectCodeBlocks(tokens);
		const parsed = { tokens, codeBlocks };
		rememberParsedMarkdown(source, parsed);
		return parsed;
	}

	function hasOpenTrailingFence(source: string): boolean {
		const fenceLines = source.match(/^```/gm);
		return !!fenceLines && fenceLines.length % 2 === 1;
	}

	function renderCodeFrame(code: string, normalizedLanguage: string, codeHtml: string) {
		return `<div class="code-block-frame" data-language="${escapeHtml(normalizedLanguage)}"><div class="code-block-toolbar"><span>${escapeHtml(normalizedLanguage)}</span><button class="code-copy-button" type="button" aria-label="Copy code" data-copy-default-label="Copy code" data-copy-code="${encodeURIComponent(code)}"><span class="code-copy-icon" aria-hidden="true"></span><span class="code-copy-label">Copy</span></button></div>${codeHtml}</div>`;
	}

	function renderMermaidFrame(code: string) {
		return `<div class="code-block-frame mermaid-block-frame" data-language="mermaid"><div class="code-block-toolbar"><span>mermaid</span><button class="code-copy-button" type="button" aria-label="Copy diagram source" data-copy-default-label="Copy diagram source" data-copy-code="${encodeURIComponent(code)}"><span class="code-copy-icon" aria-hidden="true"></span><span class="code-copy-label">Copy</span></button></div><div class="mermaid-block" data-mermaid-source="${encodeURIComponent(code)}"><pre class="shiki shiki-fallback mermaid-fallback"><code>${escapeHtml(code)}</code></pre></div></div>`;
	}

	async function copyTextToClipboard(text: string): Promise<void> {
		try {
			await rpc.request.writeClipboardText({ text });
			return;
		} catch (rpcError) {
			if (navigator.clipboard?.writeText) {
				try {
					await navigator.clipboard.writeText(text);
					return;
				} catch (clipboardError) {
					throw new Error("Native and browser clipboard writes failed.", {
						cause: clipboardError,
					});
				}
			}

			if (!document.queryCommandSupported?.("copy")) {
				throw rpcError;
			}
		}

		const fallback = document.createElement("textarea");
		fallback.value = text;
		fallback.setAttribute("readonly", "true");
		fallback.style.position = "fixed";
		fallback.style.top = "0";
		fallback.style.left = "0";
		fallback.style.opacity = "0";
		document.body.appendChild(fallback);
		fallback.focus();
		fallback.select();

		try {
			const copied = document.execCommand("copy");
			if (!copied) {
				throw new Error("Document copy command was rejected.");
			}
		} finally {
			document.body.removeChild(fallback);
		}
	}

	function resetCopyButton(button: HTMLButtonElement) {
		button.classList.remove("copied", "copy-error");
		const defaultLabel = button.dataset.copyDefaultLabel ?? "Copy code";
		button.setAttribute("aria-label", defaultLabel);
		button.setAttribute("title", defaultLabel);
		const label = button.querySelector(".code-copy-label");
		if (label) label.textContent = "Copy";
	}

	async function handleMarkdownClick(event: MouseEvent) {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const button = target.closest<HTMLButtonElement>(".code-copy-button");
		if (!button || !containerElement?.contains(button)) return;

		event.preventDefault();
		event.stopPropagation();

		if (copyResetTimer) {
			clearTimeout(copyResetTimer);
			copyResetTimer = null;
		}

		containerElement.querySelectorAll<HTMLButtonElement>(".code-copy-button").forEach(resetCopyButton);

		try {
			await copyTextToClipboard(decodeURIComponent(button.dataset.copyCode ?? ""));
			button.classList.add("copied");
			button.setAttribute("aria-label", "Copied code");
			button.setAttribute("title", "Copied code");
			const label = button.querySelector(".code-copy-label");
			if (label) label.textContent = "Copied";
		} catch (error) {
			console.error("Failed to copy code block:", error);
			button.classList.add("copy-error");
			button.setAttribute("aria-label", "Copy failed");
			button.setAttribute("title", "Copy failed");
			const label = button.querySelector(".code-copy-label");
			if (label) label.textContent = "Failed";
		}

		copyResetTimer = window.setTimeout(() => {
			resetCopyButton(button);
			copyResetTimer = null;
		}, 1800);
	}

	function getCodeToHighlightedHtml() {
		codeToHighlightedHtmlPromise ??= (async () => {
			const { createBundledHighlighter, createSingletonShorthands } = await import("shiki/core");
			const { createJavaScriptRegexEngine } = await import("shiki/engine/javascript");
			const createHighlighter = createBundledHighlighter({
				langs: {
					bash: () => import("shiki/langs/bash"),
					css: () => import("shiki/langs/css"),
					diff: () => import("shiki/langs/diff"),
					go: () => import("shiki/langs/go"),
					html: () => import("shiki/langs/html"),
					javascript: () => import("shiki/langs/javascript"),
					json: () => import("shiki/langs/json"),
					jsx: () => import("shiki/langs/jsx"),
					markdown: () => import("shiki/langs/markdown"),
					python: () => import("shiki/langs/python"),
					rust: () => import("shiki/langs/rust"),
					svelte: () => import("shiki/langs/svelte"),
					toml: () => import("shiki/langs/toml"),
					tsx: () => import("shiki/langs/tsx"),
					typescript: () => import("shiki/langs/typescript"),
					yaml: () => import("shiki/langs/yaml"),
				},
				themes: {
					"github-dark": () => import("shiki/themes/github-dark"),
					"github-light": () => import("shiki/themes/github-light"),
				},
				engine: () => createJavaScriptRegexEngine(),
			});
			const { codeToHtml } = createSingletonShorthands(createHighlighter);
			return (code: string, lang: HighlightLanguage, theme: "light" | "dark") =>
				codeToHtml(code, {
					lang,
					theme: theme === "dark" ? "github-dark" : "github-light",
				});
		})();
		return codeToHighlightedHtmlPromise;
	}

	markdown = new MarkdownIt({
		html: false,
		linkify: false,
		breaks: false,
		typographer: false,
	})
		.use(footnote)
		.use(deflist)
		.use(abbr)
		.use(katex, {
			throwOnError: false,
			output: "html",
		})
		.use(taskLists, { enabled: false });
	markdown.renderer.rules.fence = (tokens, index) => {
		const token = tokens[index];
		const normalizedLanguage = normalizeLanguage(token.info);
		if (normalizedLanguage === "mermaid") return renderMermaidFrame(token.content);
		const highlighted = highlightedCode[
			codeKey(token.content, normalizedLanguage, activeColorTheme)
		];
		return renderCodeFrame(
			token.content,
			normalizedLanguage,
			highlighted ??
				`<pre class="shiki shiki-fallback"><code>${escapeHtml(token.content)}</code></pre>`,
		);
	};

	$effect(() => {
		activeColorTheme = readColorTheme();
		const root = document.documentElement;
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const observer = new MutationObserver(() => {
			activeColorTheme = readColorTheme();
		});
		const syncFromSystem = () => {
			activeColorTheme = readColorTheme();
		};
		observer.observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });
		media.addEventListener("change", syncFromSystem);
		return () => {
			observer.disconnect();
			media.removeEventListener("change", syncFromSystem);
		};
	});

	$effect(() => {
		const parsed = getParsedMarkdown(content);
		const theme = activeColorTheme;
		const codeBlocks = !isFinished && hasOpenTrailingFence(content)
			? parsed.codeBlocks.slice(0, -1)
			: parsed.codeBlocks;
		if (codeBlocks.length === 0) return;

		let cancelled = false;
		void (async () => {
			const codeToHighlightedHtml = await getCodeToHighlightedHtml();
			const nextHighlighted: Record<string, string> = {};

			for (const block of codeBlocks) {
				const normalizedLanguage = normalizeLanguage(block.lang);
				if (normalizedLanguage === "mermaid") continue;
				const lang = toHighlightLanguage(normalizedLanguage);
				const key = codeKey(block.text, normalizedLanguage, theme);
				nextHighlighted[key] = await codeToHighlightedHtml(block.text, lang, theme);
			}

			if (!cancelled) highlightedCode = nextHighlighted;
		})();

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		return () => {
			if (copyResetTimer) {
				clearTimeout(copyResetTimer);
				copyResetTimer = null;
			}
		};
	});

	const parsedMarkdown = $derived(getParsedMarkdown(content));
	const renderedHtml = $derived(markdown.renderer.render(parsedMarkdown.tokens, markdown.options, {}));

	$effect(() => {
		const root = containerElement;
		if (!root) return;

		root.addEventListener("click", handleMarkdownClick);
		return () => {
			root.removeEventListener("click", handleMarkdownClick);
		};
	});

	$effect(() => {
		const root = containerElement;
		const html = renderedHtml;
		const theme = activeColorTheme;
		if (!root || !html) return;

		let cancelled = false;
		void (async () => {
			await tick();
			const blocks = [...root.querySelectorAll<HTMLElement>(".mermaid-block[data-mermaid-source]")];
			if (blocks.length === 0) return;
			for (const block of blocks) block.dataset.renderState = "loading";

			let mermaid: (typeof import("mermaid"))["default"];
			try {
				({ default: mermaid } = await import("mermaid"));
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: "strict",
					theme: theme === "dark" ? "dark" : "base",
					themeVariables: {
						background: "transparent",
						mainBkg: mermaidColorVariable("--ui-surface"),
						primaryColor: mermaidColorVariable("--ui-surface"),
						primaryTextColor: mermaidColorVariable("--ui-text-primary"),
						primaryBorderColor: mermaidColorVariable("--ui-border-strong"),
						lineColor: mermaidColorVariable("--ui-text-tertiary"),
						secondaryColor: mermaidColorVariable("--ui-surface-subtle"),
						tertiaryColor: mermaidColorVariable("--ui-bg"),
						fontFamily: "var(--font-sans)",
					},
				});
			} catch (error) {
				if (cancelled) return;
				const message = error instanceof Error ? error.message : String(error);
				for (const block of blocks) {
					block.dataset.renderState = "error";
					block.dataset.renderError = message;
					block.classList.add("mermaid-error");
				}
				console.error("Failed to load Mermaid renderer:", error);
				return;
			}

			for (const [index, block] of blocks.entries()) {
				const sourceAttribute = block.dataset.mermaidSource;
				if (!sourceAttribute) continue;
				const source = decodeURIComponent(sourceAttribute);
				block.dataset.renderState = "rendering";
				try {
					const id = `assistant-mermaid-${++mermaidRenderCounter}-${index}`;
					const { svg, bindFunctions } = await mermaid.render(id, source);
					if (cancelled) return;
					block.innerHTML = `<div class="mermaid-rendered">${svg}</div>`;
					bindFunctions?.(block);
					block.dataset.renderState = "rendered";
				} catch (error) {
					if (cancelled) return;
					block.dataset.renderState = "error";
					block.dataset.renderError = error instanceof Error ? error.message : String(error);
					block.classList.add("mermaid-error");
					console.error("Failed to render Mermaid diagram:", error);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	});
</script>

<div
	bind:this={containerElement}
	class="assistant-markdown"
	data-finished={isFinished}
>
	{@html renderedHtml}
</div>

<style>
	.assistant-markdown {
		min-width: 0;
		overflow-wrap: anywhere;
		word-break: break-word;
		white-space: normal;
		font-size: var(--text-base);
		line-height: 1.58;
		color: var(--ui-text-primary);
	}

	.assistant-markdown :global(*:first-child) {
		margin-top: 0;
	}

	.assistant-markdown :global(*:last-child) {
		margin-bottom: 0;
	}

	.assistant-markdown :global(p) {
		margin: 0;
		white-space: pre-wrap;
	}

	.assistant-markdown :global(p + p),
	.assistant-markdown :global(p + ul),
	.assistant-markdown :global(p + ol),
	.assistant-markdown :global(ul + p),
	.assistant-markdown :global(ol + p),
	.assistant-markdown :global(pre + p),
	.assistant-markdown :global(p + pre),
	.assistant-markdown :global(table + p),
	.assistant-markdown :global(p + table),
	.assistant-markdown :global(blockquote + p),
	.assistant-markdown :global(p + blockquote) {
		margin-top: 0.72rem;
	}

	.assistant-markdown :global(h1),
	.assistant-markdown :global(h2),
	.assistant-markdown :global(h3),
	.assistant-markdown :global(h4),
	.assistant-markdown :global(h5),
	.assistant-markdown :global(h6) {
		margin: 0.95rem 0 0.45rem;
		font-size: var(--text-lg);
		line-height: 1.35;
		font-weight: 600;
		letter-spacing: 0;
		color: var(--ui-text-primary);
	}

	.assistant-markdown :global(h1) {
		font-size: var(--text-heading-sm);
	}

	.assistant-markdown :global(h2) {
		font-size: var(--text-lg);
	}

	.assistant-markdown :global(ul),
	.assistant-markdown :global(ol) {
		margin: 0.42rem 0 0;
		padding-left: 1.15rem;
		list-style-position: outside;
		white-space: normal;
	}

	.assistant-markdown :global(li::marker) {
		color: var(--ui-text-tertiary);
	}

	.assistant-markdown :global(ul ul),
	.assistant-markdown :global(ul ol),
	.assistant-markdown :global(ol ul),
	.assistant-markdown :global(ol ol) {
		margin-top: 0.12rem;
	}

	.assistant-markdown :global(li) {
		margin: 0;
		padding-left: 0.08rem;
	}

	.assistant-markdown :global(li + li) {
		margin-top: 0.12rem;
	}

	.assistant-markdown :global(li > p) {
		margin: 0;
		white-space: normal;
	}

	.assistant-markdown :global(li > p + p) {
		margin-top: 0.38rem;
	}

	.assistant-markdown :global(dl) {
		margin: 0.72rem 0 0;
		white-space: normal;
	}

	.assistant-markdown :global(dt) {
		margin-top: 0.48rem;
		font-weight: 600;
		color: var(--ui-text-primary);
	}

	.assistant-markdown :global(dd) {
		margin: 0.16rem 0 0 0.88rem;
		padding-left: 0.58rem;
		border-left: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
		color: var(--ui-text-secondary);
	}

	.assistant-markdown :global(.contains-task-list),
	.assistant-markdown :global(ul:has(> li > input[type="checkbox"])) {
		padding-left: 0;
		list-style: none;
	}

	.assistant-markdown :global(.task-list-item),
	.assistant-markdown :global(li:has(> input[type="checkbox"])) {
		display: flex;
		gap: 0.42rem;
		align-items: flex-start;
		padding-left: 0;
	}

	.assistant-markdown :global(.task-list-item input),
	.assistant-markdown :global(li > input[type="checkbox"]) {
		width: 0.82rem;
		height: 0.82rem;
		margin: 0.29rem 0 0;
		accent-color: var(--ui-accent);
	}

	.assistant-markdown :global(code) {
		padding: 0.08rem 0.26rem;
		border-radius: var(--ui-radius-xs);
		background: color-mix(in oklab, var(--ui-surface-muted) 72%, transparent);
		font-family: var(--font-mono);
		font-size: 0.86em;
		color: color-mix(in oklab, var(--ui-text-primary) 94%, var(--ui-accent));
	}

	.assistant-markdown :global(.code-block-frame) {
		margin: 0.72rem 0 0;
		overflow: hidden;
		border-radius: var(--ui-radius-sm);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 84%, transparent);
		background: color-mix(in oklab, var(--ui-code) 92%, var(--ui-surface));
	}

	.assistant-markdown :global(.mermaid-block) {
		min-height: 3rem;
		overflow-x: auto;
		background: color-mix(in oklab, var(--ui-code) 92%, var(--ui-surface));
	}

	.assistant-markdown :global(.mermaid-rendered) {
		display: flex;
		justify-content: center;
		min-width: max-content;
		padding: 0.85rem;
	}

	.assistant-markdown :global(.mermaid-rendered),
	.assistant-markdown :global(.mermaid-rendered *) {
		overflow-wrap: normal;
		word-break: normal;
	}

	.assistant-markdown :global(.mermaid-rendered p) {
		white-space: normal;
	}

	.assistant-markdown :global(.mermaid-rendered svg) {
		display: block;
		max-width: min(100%, 48rem);
		height: auto;
	}

	.assistant-markdown :global(.mermaid-error .mermaid-fallback) {
		display: block;
	}

	.assistant-markdown :global(.katex) {
		color: var(--ui-text-primary);
		font-size: 1em;
	}

	.assistant-markdown :global(.katex-display) {
		margin: 0.72rem 0;
		overflow-x: auto;
		overflow-y: hidden;
		padding: 0.35rem 0;
	}

	.assistant-markdown :global(.code-block-toolbar) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		min-height: 1.9rem;
		padding: 0.28rem 0.44rem 0.28rem 0.62rem;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 68%, transparent);
		background: color-mix(in oklab, var(--ui-surface-muted) 38%, transparent);
		color: var(--ui-text-tertiary);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1;
	}

	.assistant-markdown :global(.code-copy-button) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		min-width: 4.2rem;
		height: 1.38rem;
		padding: 0 0.42rem;
		border-radius: var(--ui-radius-xs);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
		background: color-mix(in oklab, var(--ui-surface-subtle) 60%, transparent);
		color: var(--ui-text-secondary);
		font: inherit;
		cursor: pointer;
		transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
	}

	.assistant-markdown :global(.code-copy-button:hover),
	.assistant-markdown :global(.code-copy-button:focus-visible) {
		border-color: color-mix(in oklab, var(--ui-accent) 44%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-accent-soft) 42%, var(--ui-surface-subtle));
		color: var(--ui-text-primary);
	}

	.assistant-markdown :global(.code-copy-button:focus-visible) {
		outline: none;
		box-shadow: var(--ui-focus-ring);
	}

	.assistant-markdown :global(.code-copy-button.copied) {
		border-color: color-mix(in oklab, var(--ui-success) 42%, var(--ui-border-soft));
		color: color-mix(in oklab, var(--ui-success) 82%, var(--ui-text-primary));
	}

	.assistant-markdown :global(.code-copy-button.copy-error) {
		border-color: color-mix(in oklab, var(--ui-danger) 48%, var(--ui-border-soft));
		color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
	}

	.assistant-markdown :global(.code-copy-icon) {
		position: relative;
		width: 0.72rem;
		height: 0.72rem;
	}

	.assistant-markdown :global(.code-copy-icon::before),
	.assistant-markdown :global(.code-copy-icon::after) {
		content: "";
		position: absolute;
		border: 1.5px solid currentColor;
		border-radius: var(--ui-radius-xs);
	}

	.assistant-markdown :global(.code-copy-icon::before) {
		inset: 0.18rem 0 0 0.14rem;
	}

	.assistant-markdown :global(.code-copy-icon::after) {
		inset: 0 0.16rem 0.18rem 0;
		background: color-mix(in oklab, var(--ui-surface-subtle) 60%, transparent);
	}

	.assistant-markdown :global(pre) {
		margin: 0;
		overflow-x: auto;
		background: color-mix(in oklab, var(--ui-code) 92%, var(--ui-surface));
		padding: 0.62rem 0.68rem;
	}

	.assistant-markdown :global(.shiki) {
		background: color-mix(in oklab, var(--ui-code) 92%, var(--ui-surface)) !important;
	}

	.assistant-markdown :global(pre code) {
		display: block;
		min-width: max-content;
		padding: 0;
		border-radius: 0;
		background: transparent;
		color: var(--ui-text-primary);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: 1.5;
		white-space: pre;
	}

	.assistant-markdown :global(blockquote) {
		margin: 0.72rem 0 0;
		padding: 0.1rem 0 0.1rem 0.7rem;
		border-left: 2px solid color-mix(in oklab, var(--ui-accent) 62%, var(--ui-border-strong));
		color: var(--ui-text-secondary);
	}

	.assistant-markdown :global(blockquote p) {
		white-space: normal;
	}

	.assistant-markdown :global(.footnotes) {
		margin-top: 0.9rem;
		padding-top: 0.62rem;
		border-top: 1px solid color-mix(in oklab, var(--ui-border-soft) 84%, transparent);
		color: var(--ui-text-secondary);
		font-size: var(--text-sm);
	}

	.assistant-markdown :global(.footnotes ol) {
		margin-top: 0.34rem;
	}

	.assistant-markdown :global(.footnote-ref a),
	.assistant-markdown :global(.footnote-backref) {
		color: color-mix(in oklab, var(--ui-accent) 76%, var(--ui-text-primary));
		text-decoration: none;
	}

	.assistant-markdown :global(abbr[title]) {
		text-decoration: underline dotted color-mix(in oklab, var(--ui-text-tertiary) 72%, transparent);
		text-underline-offset: 0.16em;
		cursor: help;
	}

	.assistant-markdown :global(table) {
		display: block;
		width: max-content;
		max-width: 100%;
		margin-top: 0.72rem;
		overflow-x: auto;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}

	.assistant-markdown :global(th),
	.assistant-markdown :global(td) {
		padding: 0.38rem 0.5rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 84%, transparent);
		text-align: left;
		vertical-align: top;
	}

	.assistant-markdown :global(th) {
		background: color-mix(in oklab, var(--ui-surface-muted) 64%, transparent);
		font-weight: 600;
	}

	.assistant-markdown :global(hr) {
		height: 1px;
		margin: 0.72rem 0;
		border: none;
		background: color-mix(in oklab, var(--ui-border-soft) 84%, transparent);
	}

	.assistant-markdown :global(del) {
		color: var(--ui-text-tertiary);
	}

	.assistant-markdown :global(a) {
		color: color-mix(in oklab, var(--ui-accent) 82%, var(--ui-text-primary));
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 0.18em;
	}

	.assistant-markdown :global(a:hover),
	.assistant-markdown :global(a:focus-visible) {
		outline: none;
		color: var(--ui-text-primary);
		background: color-mix(in oklab, var(--ui-accent-soft) 72%, transparent);
	}
</style>
