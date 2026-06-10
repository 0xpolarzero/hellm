# TinyFish CLI

Run web automations from your terminal, shell scripts, and CI/CD pipelines.

## Authentication

Get your API key from [agent.tinyfish.ai](https://agent.tinyfish.ai).

```bash
# Interactive (opens browser, prompts for key)
tinyfish auth login

# CI/CD safe (pipe key via stdin)
echo $TINYFISH_API_KEY | tinyfish auth set

```

## Usage

### Run an automation

```bash
# Stream steps as they happen (default)
tinyfish agent run "Find the pricing page" --url https://example.com

# Human-readable output
tinyfish agent run "Find the pricing page" --url https://example.com --pretty

# Use a browser profile and stricter agent limits
tinyfish agent run "Check checkout" \
  --url https://example.com \
  --browser-profile stealth \
  --mode strict \
  --max-steps 75

# Wait for result without streaming
tinyfish agent run "Find the pricing page" --url https://example.com --sync

# Submit and return immediately (don't wait)
tinyfish agent run "Find the pricing page" --url https://example.com --async

# Request structured output with an inline JSON Schema
tinyfish agent run "Extract the product price" \
  --url https://example.com/product \
  --sync \
  --output-schema "{\"type\":\"object\",\"properties\":{\"price\":{\"type\":\"string\"}},\"required\":[\"price\"]}"

# Or load the schema from a file
tinyfish agent run "Extract the product price" \
  --url https://example.com/product \
  --sync \
  --output-schema-file ./schemas/product-price.json
```

### Structured output

Use `--output-schema <json>` for short inline schemas and `--output-schema-file <path>` for schemas you want to reuse, review, or keep in source control.
Both flags work with the default streaming mode, `--sync`, and `--async`.

Example schema file:

```json
{
  "type": "object",
  "properties": {
    "price": { "type": "string" },
    "currency": { "type": "string" }
  },
  "required": ["price", "currency"]
}
```

### Manage runs

```bash
# List recent runs
tinyfish agent run list --pretty

# Filter by status
tinyfish agent run list --status RUNNING --pretty

# Inspect a run
tinyfish agent run get <run_id> --pretty

# Print the step-by-step trace
tinyfish agent run steps <run_id> --pretty

# Watch a run live (polls the steps endpoint; exits when the run finishes)
tinyfish agent run watch <run_id> --pretty
tinyfish agent run watch <run_id> --pretty --interval 5000 --timeout 600000

# Cancel a run
tinyfish agent run cancel <run_id> --pretty
```

### Search

```bash
# Query TinyFish Search
tinyfish search query "agentql pricing"

# Add location and language hints
tinyfish search query "agentql pricing" --location US --language en

# Human-readable output
tinyfish search query "agentql pricing" --pretty
```

### Fetch

```bash
# Fetch extracted content from one or more URLs
tinyfish fetch content get https://agentql.com

# Choose the output format
tinyfish fetch content get https://agentql.com --format markdown

# Include links and image links
tinyfish fetch content get https://agentql.com --links --image-links

# Human-readable output
tinyfish fetch content get https://agentql.com --pretty
```

### Browser

```bash
# Create a remote browser session
tinyfish browser session create

# Open a URL when the session starts
tinyfish browser session create --url https://agentql.com

# Human-readable output
tinyfish browser session create --pretty
```

### Output format

By default all commands output newline-delimited JSON to stdout — pipe-friendly for agents and scripts. Add `--pretty` for human-readable output.

Errors are JSON to stderr with exit code 1. Ctrl+C during a streaming run cancels it automatically.

`--output-schema` and `--output-schema-file` are mutually exclusive. Both inputs must parse to a top-level JSON object. The CLI only validates that outer shape locally; the API performs full schema validation and may return errors such as `INVALID_INPUT` or feature-flag access failures.

`--browser-profile` accepts `lite` or `stealth`. `--mode` accepts `default` or `strict`. `--max-steps` accepts values from 1 to 500. `--session-id <uuid>` is a caller-provided UUID that lets concurrent `--sync` calls stay idempotent.

### Debug

```bash
TINYFISH_DEBUG=1 tinyfish agent run "..." --url https://example.com
# or
tinyfish --debug agent run "..." --url https://example.com
```

## Auth Status And Logout

```bash
tinyfish auth status
tinyfish auth status --pretty
tinyfish auth logout
```

## Batch Agent Automation

```bash
tinyfish agent batch run --input runs.csv
tinyfish agent batch list
tinyfish agent batch get <batch_id>
tinyfish agent batch cancel <batch_id>
```
