# Freestyle sandbox provider example

[Freestyle VMs](https://docs.freestyle.sh/v2/vms) are extremely powerful sandboxes with nested virtualization, full networking, and the ability to scale to more resources than alternatives. Use Freestyle VMs when you want to give your agents a real computer, not a code runner.

This example shows the sandbox-provider shape for a Freestyle VM integration.

`provider.ts` exports `createFreestyleSandboxProvider()`, which implements the Smithers `SandboxProvider` contract. It creates a Freestyle VM, ships a request file with `additionalFiles`, runs a command with `vm.exec()`, reads a result JSON file, and returns a Smithers sandbox result bundle.

`workflow.tsx` uses a mock Freestyle client so the example typechecks and runs without credentials. To use real Freestyle VMs:

```ts
import { freestyle } from "freestyle";
import { createFreestyleSandboxProvider } from "./provider.js";

const freestyleProvider = createFreestyleSandboxProvider({
  freestyle,
  command: "node /workspace/run-smithers-sandbox.js",
  idleTimeoutSeconds: 60,
  createOptions: {
    additionalFiles: {
      "/workspace/run-smithers-sandbox.js": {
        content: "...write /workspace/smithers-result.json here...",
      },
    },
  },
});
```

The remote command must write `/workspace/smithers-result.json` as JSON:

```json
{
  "status": "finished",
  "output": { "summary": "done" },
  "runId": "remote-run-id",
  "diffBundle": {
    "seq": 1,
    "baseRef": "HEAD",
    "patches": []
  }
}
```

Smithers validates the returned bundle, records sandbox lifecycle events, and applies `diffBundle` only when review policy allows it.
