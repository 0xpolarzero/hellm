export const TINYFISH_WEB_PROMPT = [
  "TinyFish provider notes:",
  "- TinyFish provides separate Search and Fetch surfaces for agent web research.",
  "- TinyFish Fetch renders pages in a browser-like environment and can return extracted markdown, HTML, or JSON.",
  "- Use TinyFish Search for ranked public web discovery; use Fetch for selected source URLs.",
  "- svvy passes TinyFish credentials only through scoped runtime configuration and does not write them into global TinyFish config files.",
  "- After `web.fetch`, inspect the returned artifact paths with file tools when you need page details.",
].join("\n");
