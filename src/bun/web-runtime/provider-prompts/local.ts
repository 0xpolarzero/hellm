export const LOCAL_WEB_PROMPT = [
  "Local provider notes:",
  "- Local is the no-key web provider. Search quality may be weaker than hosted providers.",
  "- Use `web.search` for URL discovery and `web.fetch` once you know the source URL.",
  "- `web.fetch` writes page content artifacts and returns artifact paths plus metadata, not full page bodies.",
  "- The Local provider never uses browser cookies or private app session state.",
].join("\n");
