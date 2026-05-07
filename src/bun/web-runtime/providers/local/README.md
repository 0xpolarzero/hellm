# Local Web Provider Research

The first production Local provider is intentionally isolated under this directory so the whole `web-runtime` can be extracted later.

Research decision for the initial implementation:

- Use no API key and no authenticated browser state.
- Fetch public `http` and `https` pages directly with Bun's `fetch`.
- Extract readable text with a small deterministic HTML cleanup rather than browser cookies or a visible desktop browser.
- Broker no-key search through DuckDuckGo's public HTML endpoint with conservative parsing and clear warnings, because this keeps packaging simple while preserving the provider boundary for a stronger local search backend later.

Rejected for the first pass:

- Global browser automation, because it risks private session state and packaging complexity.
- Self-hosted services, because requiring a separate daemon would make Local not actually ready by default.
- Hosted search APIs, because Local must be no-key.

Future candidates can replace only `providers/local/index.ts` behind the same provider contract.
