export const FIRECRAWL_WEB_PROMPT = [
  "Firecrawl provider notes:",
  "- Firecrawl Search can return SERP-style results and can include scrapeOptions when complete page content should be collected with search.",
  "- Firecrawl fetch uses scrape-shaped controls such as formats, onlyMainContent, includeTags, excludeTags, waitFor, and timeout.",
  "- Preserve Firecrawl-specific filters and scrape controls when they help reduce irrelevant results.",
  "- `web.fetch` writes fetched content artifacts and returns artifact references plus metadata, not full page bodies.",
].join("\n");
