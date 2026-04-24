# AI Agent Sandboxing Research

Date: 2026-04-23

## Purpose

This note captures current emerging practice around sandboxing for coding agents, with emphasis on security, autonomy, usability, and how these tradeoffs should shape `svvy`.

The goal is not just to summarize products. The goal is to extract the design patterns that now look durable enough to inform the shipped product.

## Executive Summary

The market is converging on a simple but important conclusion:

1. Sandboxing is not one control.
2. Strong systems split sandboxing into two layers:
   - runtime isolation
   - capability governance
3. Runtime isolation answers "where can this code run and what can that process touch?"
4. Capability governance answers "what is this actor allowed to do semantically, even inside its sandbox?"

The best current systems do both.

The weakest systems still rely on only one of these:

- strong runtime isolation with weak policy, approvals, and auditing
- strong policy prompts on top of weak host isolation

For `svvy`, the strongest direction is:

- keep one strategic orchestrator outside the high-power task runtime
- give handler threads policy authority and supervision responsibility
- run workflow task agents inside explicit sandbox profiles
- distinguish local low-latency trusted work from remote autonomous untrusted work
- treat repo config, workflow assets, hooks, MCP servers, and workspace settings as part of the execution layer, not as passive metadata
- combine a code-first tool surface such as `execute_typescript` with a real sandbox runtime and a host-side policy gate, rather than treating any one layer as the whole solution

## What "Sandboxing" Means in Practice

There are several very different things currently marketed as "sandboxing":

### 1. Local per-process OS sandbox

The agent runs on the user's machine, but commands execute with OS restrictions on filesystem, network, or process behavior.

Examples:

- Claude Code local sandboxing on macOS and Linux
- Codex CLI local sandboxing
- Cursor local agent sandboxing
- VS Code terminal sandboxing

This is low-latency and integrates naturally with a local workspace, but it is only as strong as the host OS primitives and the boundary configuration.

### 2. Container sandbox

The agent runs inside a container with process and filesystem isolation, often with a bind mount to the workspace.

Examples:

- OpenHands Docker sandbox
- Cloudflare Sandbox SDK
- many self-hosted agent platforms

This improves reproducibility and reduces blast radius, but plain containers still share the host kernel.

### 3. Sandboxed container with userspace kernel

The workload still looks container-like, but system calls are mediated by a userspace kernel layer such as gVisor.

Examples:

- GKE Agent Sandbox
- GKE Sandbox
- some security-focused Kubernetes deployments

This is stronger than plain containers and usually cheaper than full VMs, but still has a different trust model than a microVM.

### 4. MicroVM sandbox

The workload runs in a lightweight VM with its own guest kernel.

Examples:

- Vercel Sandbox
- Docker Sandboxes
- Firecracker-based platforms

This is currently the strongest generally available option for running untrusted coding-agent workloads without shipping a full traditional VM product experience.

### 5. Remote cloud task container or VM

The task runs away from the user's machine in provider infrastructure, often with repo contents copied in rather than host-mounted.

Examples:

- OpenAI Codex cloud tasks
- GitHub Copilot cloud agent
- Cursor background agents
- E2B
- Daytona

This materially lowers host compromise risk because the local machine is not the execution surface. It does not remove the need for egress controls, secret discipline, and approval boundaries.

### 6. Wasm or custom tool runtimes

This is emerging, especially for narrowly scoped tool execution, but it is not yet the general answer for full coding-agent workflows that need package managers, git, browsers, compilers, and arbitrary CLIs.

## Isolation Technology Landscape

## OS-level local sandboxes

### Claude Code

Claude Code documents OS-level enforcement using Seatbelt on macOS and bubblewrap on Linux and WSL2. Child processes inherit the same sandbox constraints. It also documents an explicit escape hatch where commands can be re-run outside the sandbox after approval.

Important signals:

- sandboxing is first-class, not an afterthought
- the whole subprocess tree matters
- sandbox failure should ideally be treated as a hard failure, not a silent downgrade

Sources:

- [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing)
- [Claude Code security](https://code.claude.com/docs/en/security)

### Codex CLI and Codex app

Codex CLI documents platform-specific sandboxing and explicit sandbox escalation when a command needs broader access. OpenAI also states that the Codex app uses the same native system-level sandboxing model.

Important signals:

- default writable scope is intentionally narrow
- escalation is explicit and scoped
- the product positions sandboxing as a normal operating mode, not a niche expert feature

Sources:

- [Codex CLI sandboxing](https://openai-codex.mintlify.app/concepts/sandboxing)
- [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)

### Cursor

Cursor published a useful design note describing why it rejected several local sandbox approaches on macOS. It evaluated App Sandbox, containers, VMs, and Seatbelt, then chose Seatbelt because App Sandbox created code-signing trust problems, containers constrained binaries, and VMs imposed too much startup and memory overhead.

This is a good example of a real product making the "developer experience versus boundary strength" tradeoff explicitly rather than pretending there is one universally correct local model.

Source:

- [Cursor local agent sandboxing](https://cursor.com/blog/agent-sandboxing)

### VS Code

VS Code's current security baseline for agentic development is notable because it combines:

- workspace trust
- terminal sandboxing
- trusted domains
- protected files
- MCP review

That package of controls is closer to what a serious desktop agent product should look like than a simple "allow commands / deny commands" gate.

Source:

- [VS Code security for AI-powered development](https://code.visualstudio.com/docs/copilot/security)

## Container, gVisor, and microVM infrastructure

### gVisor

gVisor inserts a per-sandbox application kernel between workloads and the host kernel. It exists specifically to reduce container escape risk while preserving a container-like operational model.

This is a strong middle layer when:

- containers are too weak
- microVMs are too heavy for the target workflow
- Kubernetes-native operations matter

Sources:

- [gVisor overview](https://gvisor.dev/docs/)
- [gVisor security intro](https://gvisor.dev/docs/architecture_guide/intro/)

### Firecracker and microVMs

Firecracker is now the reference primitive behind a meaningful chunk of the AI-agent sandbox market. The important property is not just speed; it is the separate guest kernel and sharply reduced attack surface.

Source:

- [Firecracker repository and overview](https://github.com/firecracker-microvm/firecracker)

### GKE Agent Sandbox

Google's GKE Agent Sandbox puts agent-oriented sandboxing into a Kubernetes shape and uses gVisor-backed runtime classes. The docs are explicit about non-root execution, token handling, and runtime isolation configuration.

This matters because it shows the platform world now treating AI-generated code execution as a first-class orchestration problem rather than just "run a pod and hope."

Sources:

- [GKE Agent Sandbox guide](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/agent-sandbox)
- [GKE Sandbox concepts](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/sandbox-pods)

## Product and provider survey

The table below focuses on the security-relevant shape of current offerings rather than feature marketing.

| System | Primary execution model | Isolation boundary | Network model | Persistence model | Security ideas worth copying | Main limitations |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI Codex cloud | Remote per-task environment | Cloud container per task | Internet blocked during agent phase by default, configurable per environment | Ephemeral task environment | Separate setup-time and agent-time internet; inspectable logs and citations | Still needs secret discipline and policy gating |
| OpenAI Codex CLI/app | Local agent with sandbox + escalation | OS-level local sandbox | Restricted until explicit escalation | Local workspace state | Narrow writable roots and explicit escalation flow | Host remains in play |
| Anthropic Claude Code | Local sandbox and cloud sandbox options | Seatbelt/bubblewrap locally; isolated cloud sandbox on web | Filesystem and network controls; classifier-mediated auto mode emerging | Local or cloud session state | Classifier-gated autonomy; trust only scoped infrastructure | Docs note sandbox can fail open unless configured otherwise |
| GitHub Copilot cloud agent | Remote GitHub Actions-powered environment | GitHub-hosted appliance | Firewall with default allowlist and custom rules | Repo branch + PR flow | Branch restriction, workflow approval gate, repo scoping | Firewall coverage is not universal |
| Cursor background agents | Remote ubuntu machine per agent | Isolated remote machine | Internet on, setup customizable | Snapshot-oriented environment | Separate remote async agent from local IDE | Repo is remote-cloned, not host-mounted |
| Vercel Sandbox | Remote sandbox service | Firecracker microVM | Runtime-updatable network policies | Ephemeral with snapshots | Dynamic egress stages and credential brokering | Best fit for service-hosted agent execution, not local-first DX |
| Docker Sandboxes | Local or managed microVM-backed sandbox | MicroVM | Allowlisted egress via host proxy | Direct mount by default | Clear trust-boundary docs; direct explanation of what crosses the boundary | Shared workspace mounts still mean immediate local file effects |
| E2B | Remote sandbox service | Linux VM style sandbox | Internet enabled by default, configurable | Pause/resume and per-sandbox filesystem | Fast programmable cloud sandboxes; good for many isolated tasks | Default internet-open posture is not conservative |
| Daytona | Remote sandbox service | Full sandbox computer model | Configurable networking | Snapshots and forks | Snapshot/fork lineage as a first-class capability | Security posture depends on concrete deployment choices |
| Cloudflare Sandbox SDK | Remote isolated container | Isolated container | Exposed services plus configurable network behavior | Ephemeral execution | Edge deployment and controlled code execution API | Container model is not the same as microVM strength |
| Modal Sandboxes | Remote sandbox service | Secure container model | General outbound access for setup/workloads | Ephemeral | Good lifecycle and readiness model | Less opinionated on agent-specific governance |
| OpenHands Docker sandbox | Local Docker container | Container with bind mounts | Container-configured | Local mounted workspace | Very explicit about read-write mounts changing host files | Plain container boundary and host-mount risk |

### OpenAI Codex cloud

OpenAI states that each Codex cloud task runs in its own cloud container. In the Codex system card, the environment is described as having no internet access once the setup phase is complete. The more recent cloud docs refine that into a configurable per-environment model where internet is blocked during the agent phase by default and can be re-enabled selectively.

This split between setup-time internet and agent-time internet is one of the strongest emerging patterns in the whole category.

Sources:

- [OpenAI Codex system card addendum](https://cdn.openai.com/pdf/8df7697b-c1b2-4222-be00-1fd3298f351d/codex_system_card.pdf)
- [OpenAI Codex cloud internet access](https://developers.openai.com/codex/cloud/internet-access)
- [Introducing Codex](https://openai.com/index/introducing-codex/)

### Anthropic Claude Code

Anthropic's current public direction has three especially important elements:

1. local OS sandboxing for shell execution
2. cloud execution where the sandbox has server access but sensitive credentials are intentionally kept out of it
3. auto mode, where a separate classifier decides whether actions can proceed without human prompts

The classifier model is one of the most important newer developments in agent security because it moves the approval layer away from pure regex or static allowlists without dropping all human control.

Sources:

- [Claude Code sandboxing engineering post](https://www.anthropic.com/engineering/claude-code-sandboxing)
- [Claude Code auto mode](https://code.claude.com/docs/en/permission-modes)
- [Claude Code auto mode config](https://code.claude.com/docs/en/auto-mode-config)

### GitHub Copilot cloud agent

GitHub's cloud agent has a relatively mature operational safety model:

- remote execution
- internet firewall
- repo-scoped permissions
- branch restrictions
- approval before workflows triggered by agent PRs run

That combination is important. It does not trust the agent with the same powers as a normal maintainer, even inside GitHub's own environment.

GitHub's firewall docs are also refreshingly honest that coverage is limited and not a comprehensive security solution.

Sources:

- [Copilot cloud agent overview](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)
- [Copilot cloud agent firewall](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-firewall)
- [Responsible use of Copilot cloud agent](https://docs.github.com/en/copilot/responsible-use/copilot-cloud-agent)
- [Agentic Workflows AWF network reference](https://github.github.com/gh-aw/reference/network/)

### Vercel Sandbox

Vercel Sandbox is one of the clearest current examples of a microVM-first agent sandbox service. It uses Firecracker, exposes network policies as a first-class feature, supports snapshots, and adds an especially interesting credentials-brokering model that injects auth on outbound traffic so secrets do not need to enter the sandbox.

That credentials pattern is one of the best hidden gems in the current landscape.

Sources:

- [Vercel Sandbox concepts](https://vercel.com/docs/vercel-sandbox/concepts)
- [Vercel Sandbox firewall](https://vercel.com/docs/vercel-sandbox/concepts/firewall)
- [Vercel Sandbox overview](https://vercel.com/docs/vercel-sandbox/)

### Docker Sandboxes

Docker Sandboxes are notable for being very explicit about the trust boundary. The docs describe the microVM as the primary trust boundary and also explain exactly what crosses into the VM. They also spell out an important user-education point: if you use a direct workspace mount, file changes are visible on the host in real time.

That directness is worth copying in `svvy` UX and docs.

Sources:

- [Docker Sandboxes overview](https://docs.docker.com/ai/sandboxes/)
- [Docker Sandboxes security model](https://docs.docker.com/ai/sandboxes/security/)

### E2B

E2B is a strong programmable cloud sandbox substrate for agents. The security posture is flexible but not maximally conservative by default: internet access is enabled by default, each sandbox has its own isolated filesystem, and sandboxes can pause and resume.

The strongest value here is operational ergonomics for many isolated agent tasks.

Sources:

- [E2B documentation](https://www.e2b.dev/docs)
- [E2B internet access](https://e2b.dev/docs/sandbox/internet-access)
- [E2B filesystem](https://e2b.dev/docs/filesystem)
- [E2B coding agents](https://e2b.dev/docs/use-cases/coding-agents)

### Daytona

Daytona positions sandboxes as full computers for agents, not just command runners. The notable features for our purposes are snapshots and fork trees. This points toward a future where agent environments are not just ephemeral but branchable and inspectable at the environment level.

That is likely relevant to workflow retries, repair loops, and durable debugging.

Source:

- [Daytona sandboxes](https://www.daytona.io/docs/en/sandboxes/)

### Cloudflare Sandbox SDK

Cloudflare's Sandbox SDK is an important data point because it exposes secure isolated code execution directly as application infrastructure. The isolation model is container-oriented rather than microVM-oriented, but the API shape is appealing for hosted agent products.

Source:

- [Cloudflare Sandbox SDK](https://developers.cloudflare.com/sandbox/)

### Modal Sandboxes

Modal's sandbox docs matter less for security novelty and more for lifecycle quality. They expose initialization, readiness, and observability cleanly. For long-running agent work, that operational polish matters.

Source:

- [Modal Sandboxes guide](https://modal.com/docs/guide/sandboxes)

### OpenHands

OpenHands is useful mostly as a warning about the default self-hosted pattern: the agent server runs in Docker, the current working directory can be bind-mounted in, and anything mounted read-write into `/workspace` can be modified by the agent.

That is a totally valid model, but teams should not mentally translate it into "my machine is protected" if the key assets are shared into the guest.

Source:

- [OpenHands Docker sandbox](https://docs.openhands.dev/openhands/usage/sandboxes/docker)

## Focused Review Of Additional Candidates

The following items came up as especially relevant references because they each represent a different layer of the problem.

### Simple framing

| Item | What it is | Main value | Main limitation |
| --- | --- | --- | --- |
| Firecracker | microVM primitive | strongest low-level isolation in this set | not a full agent platform |
| Hazmat | local macOS containment stack | excellent local safety practices | macOS-only containment, not a remote runtime |
| `execute_typescript` / Code Mode | agent execution pattern | great DX and narrower capability surface | not a full repo or OS sandbox by itself |
| Zeroboot | ultra-fast VM sandbox substrate | compelling speed plus VM isolation | still early and not production-hardened |
| OpenSandbox | full sandbox platform for agents | most complete agent-oriented control plane | strongest isolation depends on operator-chosen runtime |

### Firecracker

Firecracker is the strongest low-level runtime primitive in this group.

What matters:

- real microVM boundary
- minimalist device model and reduced attack surface
- explicit `jailer` process for defense in depth
- clear production guidance around trusted paths, privilege drop, cgroups, and namespaces

The key takeaway is that Firecracker answers:

- "What should untrusted code run inside?"

It does not by itself answer:

- "How should the agent lifecycle work?"
- "How do file sync, approvals, egress control, and secret brokering work?"

Use Firecracker as the runtime boundary, not as the whole product architecture.

Sources:

- [Firecracker README](https://github.com/firecracker-microvm/firecracker)
- [Firecracker jailer docs](https://github.com/firecracker-microvm/firecracker/blob/main/docs/jailer.md)
- [Firecracker production host setup](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md)

### Hazmat

Hazmat is not a cloud sandbox platform. It is a local macOS containment stack for running coding agents more safely on a developer machine.

What matters:

- separate user account
- Seatbelt kernel sandboxing
- `pf` firewall rules
- DNS blocklist
- rollback and snapshot support
- explicit acknowledgement of what it does not solve

Its main value is not that it is universally portable. Its main value is that it is honest and layered. It is a good reference for what a serious trusted-local mode should look like.

The main takeaway is:

- local containment can be useful and practical
- local containment should not be confused with remote VM isolation

Source:

- [Hazmat repository](https://github.com/dredozubov/hazmat)

### `execute_typescript` / Code Mode

`execute_typescript` is best understood as an agent execution pattern, not as the whole sandbox story.

The pattern is:

- expose a narrow typed API
- ask the model to write code against it
- execute that code in an isolate or other sandbox
- return one result instead of many tool round-trips

Why it matters:

- much better developer experience for the agent
- fewer tool-round-trip tokens
- easier to expose exactly the capabilities you want
- better place to keep auth and policy on the host side

Why it is not enough on its own:

- isolates are not the same as VM-grade boundaries
- it does not automatically solve repo access, package installs, browsers, or arbitrary shell execution
- approval semantics still need care; Cloudflare currently warns that approval-required tools should not be passed through codemode because they execute immediately inside the sandbox

The main takeaway is:

- use `execute_typescript` as the agent-facing work surface
- do not mistake it for the underlying trust boundary

Sources:

- [TanStack Code Mode docs](https://tanstack.com/ai/latest/docs/code-mode/code-mode)
- [TanStack Code Mode blog](https://tanstack.com/blog/tanstack-ai-code-mode)
- [Cloudflare Code Mode docs](https://developers.cloudflare.com/agents/api-reference/codemode/)
- [Cloudflare Dynamic Workers post](https://blog.cloudflare.com/dynamic-workers/)
- [Anthropic code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp?_hsmi=390282592)

### Zeroboot

Zeroboot is the most interesting performance-oriented substrate in this set.

What matters:

- snapshots a Firecracker VM once
- forks new KVM VMs from that snapshot using copy-on-write memory mapping
- claims sub-millisecond sandbox spawn latency
- each fork remains a real KVM VM

That is exactly the direction many agent runtimes want: VM-grade isolation without traditional VM startup costs.

But the current public status matters too:

- it describes itself as a working prototype
- it is not yet production-hardened
- networking is currently absent inside forks
- several runtime limitations remain explicit

The main takeaway is:

- very important to watch
- not yet the obvious default foundation for a broadly shipped product

Source:

- [Zeroboot repository](https://github.com/zerobootdev/zeroboot)

### OpenSandbox

OpenSandbox is the most complete actual agent sandbox platform in this group.

What matters:

- multi-language SDKs
- sandbox lifecycle APIs
- CLI and MCP support
- command, filesystem, and code-interpreter surfaces
- browser and desktop examples
- Docker and Kubernetes runtimes
- server-level secure-runtime support for gVisor, Kata, and Firecracker-backed configurations
- first-class egress control component

It is much closer to a product-ready control plane than the other items in this section.

The most important caveat is that the strongest isolation is infrastructure-dependent. OpenSandbox can run with stronger runtimes, but those are deployment choices rather than guaranteed per-request product semantics.

The main takeaway is:

- if the question is "what here is closest to a full agent-sandbox platform?", OpenSandbox is the strongest answer
- if the question is "what is the strongest isolation primitive?", Firecracker still wins that layer

Sources:

- [OpenSandbox repository](https://github.com/alibaba/OpenSandbox)
- [OpenSandbox architecture](https://open-sandbox.ai/overview/architecture)
- [OpenSandbox secure runtime proposal](https://open-sandbox.ai/zh/oseps/0004-secure-container-runtime)
- [OpenSandbox egress sidecar](https://open-sandbox.ai/components/egress/readme)

## Governance Layer: The Other Half of Sandboxing

Runtime isolation alone is not enough. Several of the most interesting developments are in the policy and governance layer above the runtime.

### Anthropic auto mode

Anthropic's auto mode routes actions through a separate classifier that blocks destructive or out-of-scope actions. It trusts only the working directory and configured repo remotes by default, then allows organizations to teach it trusted infrastructure.

This is a concrete example of semantic policy enforcement, not just filesystem or network policy.

Sources:

- [Claude Code auto mode config](https://code.claude.com/docs/en/auto-mode-config)
- [Claude Code permission modes](https://code.claude.com/docs/en/permission-modes)

### GitHub AWF and cloud-agent policies

GitHub's Agent Workflow Firewall provides domain allowlisting and audit logging for network access in agentic workflows. GitHub also layers branch restrictions, repo scoping, and PR workflow approval on top of runtime isolation.

Sources:

- [Agentic Workflows AWF network reference](https://github.github.com/gh-aw/reference/network/)
- [Copilot cloud agent firewall](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-firewall)

### Microsoft Agent Governance Toolkit

AGT is important mainly because Microsoft is very explicit about its boundary: it is application-level governance, not OS or kernel isolation. That honesty is useful. It maps agentic risks to concrete controls such as capability sandboxing, MCP gateways, identity, plugin signing, and resource-limited execution rings.

The key lesson is architectural, not product-specific:

- governance is necessary
- governance is not a substitute for runtime isolation

Sources:

- [Microsoft Agent Governance Toolkit announcement](https://opensource.microsoft.com/blog/2026/04/02/introducing-the-agent-governance-toolkit-open-source-runtime-security-for-ai-agents/)
- [Microsoft AGT repository](https://github.com/microsoft/agent-governance-toolkit)

## Standards and Research Direction

### OWASP

OWASP's Securing Agentic Applications Guide is a strong emerging reference point for practical application controls. It matters less as a sandbox implementation document and more as a statement that the industry has moved from generic LLM risk discussion into concrete agent risk models.

Source:

- [OWASP Securing Agentic Applications Guide 1.0](https://genai.owasp.org/resource/securing-agentic-applications-guide-1-0/)

### NIST

NIST's work on tool-use taxonomies is valuable because it pushes builders to classify tools by effect on the environment: running code, computer use, authentication, physical extensions, and so on. That is exactly the lens needed for sane sandbox design.

Source:

- [NIST lessons learned on tool use in agent systems](https://www.nist.gov/news-events/news/2025/08/lessons-learned-consortium-tool-use-agent-systems)

### Sandbox escape benchmarking

The UK AI Security Institute's SandboxEscapeBench is important because it moves the conversation from "we have a sandbox" to "how do we know current models cannot break it?"

The existence of this benchmark changes the bar. Sandboxing has to be treated as a continuously evaluated control, not a one-time architectural claim.

Source:

- [AISI SandboxEscapeBench](https://www.aisi.gov.uk/blog/can-ai-agents-escape-their-sandboxes-a-benchmark-for-safely-measuring-container-breakout-capabilities)

## Emerging Best Practices

The following patterns show up repeatedly across the stronger systems and seem durable enough to treat as current best practice.

### 1. Separate bootstrap from autonomous execution

Allow internet and package installation during environment setup if needed. Then reduce or disable egress before the agent begins operating on sensitive code or data.

OpenAI Codex cloud and Vercel Sandbox both point in this direction.

### 2. Treat network egress as a first-class policy surface

Do not reduce network control to a single on/off toggle. Model it as:

- bootstrap egress
- task egress
- locked-down execution
- explicit allowlists for domains, paths, methods, or both

### 3. Keep secrets out of the sandbox whenever possible

Use:

- credential brokering
- short-lived scoped tokens
- outbound transforms
- repo-specific GitHub app tokens

Avoid:

- broad long-lived API keys in environment variables
- exposing host credentials directly to the guest

### 4. Make trust establishment explicit before repo-controlled execution

Do not run:

- hooks
- MCP servers
- workspace settings
- workflow assets
- repo-local permission rules
- shell startup modifications

until the workspace is trusted.

This is now table stakes, not an optional hardening pass.

### 5. Scope writes narrowly

Prefer:

- one writable workspace root
- explicit additional writable directories
- protected paths requiring approval

Avoid broad ambient write privileges across the host.

### 6. Use different policies for different actor classes

The orchestrator, handler thread, and workflow task agent do not need the same authority.

This matches `svvy`'s PRD direction and should remain explicit.

### 7. Gate high-blast-radius actions independently from ordinary coding

Examples:

- default-branch writes
- deploys
- migrations
- deleting files that predate the session
- granting cloud or repo permissions
- executing CI workflows triggered by agent branches

### 8. Prefer ephemeral sandboxes plus snapshots over long-lived mutable pets

This reduces drift while preserving speed through reuse.

### 9. Audit every important crossing

Audit:

- command execution
- file writes
- network destinations
- approval decisions
- snapshot and resume lineage
- secrets brokering events
- sandbox-to-host sync operations

### 10. Test the sandbox boundary itself

Run breakout-style evaluation and adversarial workloads, not just happy-path task tests.

### 11. Do not let the model choose whether the security boundary applies

If the model can decide between:

- restrictive sandbox
- broad local host access

then prompt injection becomes a privilege-escalation path.

A safer split is:

- the model may request capabilities
- the host policy layer decides whether to grant them
- the enforcement happens outside the model

This is an architectural inference from the broader landscape rather than a single vendor slogan, but it is strongly supported by the trend toward approvals, trusted domains, branch restrictions, workspace trust, and host-side credential brokering.

## Anti-Patterns and Failure Modes

### 1. Silent fallback to unsandboxed execution

If sandbox setup fails and the system quietly runs commands anyway, the product has effectively created a false sense of security.

Claude Code explicitly documents this behavior and provides a hard-failure setting, which is the right escape valve to expose.

### 2. Shared host mounts plus broad egress plus secrets

This is the most common self-hosted footgun:

- agent has write access to the local repo
- sandbox has general outbound internet
- secrets sit in environment variables

At that point the sandbox often reduces only accidental host breakage, not data exfiltration risk.

### 3. Treating repo config as harmless metadata

Recent security findings make this untenable. Repo-local config must be treated as executable influence.

### 4. Firewalling only some processes

GitHub is explicit that its firewall does not apply to every process category. That kind of limitation is acceptable, but only if the product is honest about it and layers other controls.

### 5. Assuming plain containers are sufficient for hostile code

Containers are often enough for trusted reproducible builds. They are not the strongest answer for adversarial or highly autonomous code generation.

### 6. Giving every agent the same token

If one sandbox is compromised, all of them should not become equivalent.

### 7. Letting the model decide whether to use the sandbox at all

This is especially dangerous under prompt injection.

If hostile repo content, web content, issue text, or tool output can persuade the model to turn off the restriction that protects the host, then the sandbox was not really a boundary in the first place.

## Design Implications for `svvy`

`svvy` already has a strong conceptual advantage because the PRD distinguishes:

- orchestrator
- handler threads
- workflow task agents

That separation should become a security boundary, not just a UX boundary.

### Recommended execution classes

`svvy` should explicitly support multiple execution classes rather than one generic "sandboxed" label.

Suggested classes:

1. `local_readonly`
   - local workspace read access
   - no write
   - no network or tightly filtered network
   - useful for analysis and planning
2. `local_workspace_write`
   - local OS sandbox
   - write only inside task root or worktree root
   - protected files require approval
   - egress filtered by allowlist
3. `remote_bootstrap`
   - remote ephemeral sandbox
   - internet allowed only for dependency/setup phase
   - no secrets inside guest if avoidable
4. `remote_task_locked`
   - remote ephemeral sandbox
   - internet off or tightly allowlisted
   - main mode for autonomous workflow task execution
5. `remote_reviewed_elevated`
   - reserved for explicit human-approved cases
   - strong logging and narrow TTL

### Recommended hybrid stack

The best current combination is not one product or one open-source repo. It is a layered stack:

1. agent-facing work surface
   - use `execute_typescript` / Code Mode or an equivalent code-first typed tool surface
2. sandbox control plane
   - use a platform that manages lifecycle, files, commands, policy, and observability
   - OpenSandbox is a strong reference shape here
3. runtime isolation layer
   - prefer VM-grade or near-VM-grade isolation for untrusted autonomous work
   - Firecracker-class runtimes are the best current reference point
4. trusted local mode
   - support a carefully constrained local mode for fast interactive work
   - Hazmat is a good reference for what serious local containment looks like

This split gives the best combined security and developer experience:

- `execute_typescript` improves agent quality and narrows the callable surface
- the control plane manages lifecycle, logs, egress, files, and approvals
- the runtime boundary contains the actual untrusted execution

### Recommended actor mapping

1. Orchestrator
   - should not receive a raw unrestricted execution surface
   - should decide policy and delegation
   - should not inherit direct workflow-runtime powers it does not need
2. Handler thread
   - should choose sandbox profile and supervise long-running work
   - should hold approvals and attention routing
   - should be able to inspect artifacts and logs without collapsing back into host shell ownership
3. Workflow task agent
   - should execute inside the strictest task-local sandbox profile that still completes the task
   - should not inherit orchestrator or handler powers
   - should receive only task-local tools and scoped credentials

### Recommended decision authority

The model should not be trusted to decide whether the security boundary applies.

The safer pattern is:

1. start in the restrictive mode by default
2. let the model declare what capability it thinks it needs
3. evaluate that request in a host-controlled policy layer
4. approve, deny, or route to a human gate outside the model

In simple terms:

- the agent can ask for more privilege
- the agent does not grant itself more privilege

This should be especially strict for:

- host filesystem mounts
- broader network egress
- secret exposure
- default-branch writes
- deploys
- shell execution outside the sandbox

### Recommended file-sync model

The product should distinguish clearly between:

- direct local mount
- copy-in / diff-out
- snapshot / resume

Default recommendation:

- use direct local mount only for trusted low-latency interactive tasks
- use copy-in / diff-out or worktree-based sync for autonomous workflows and untrusted repositories

This should be explicit in the product, because users routinely misunderstand "sandboxed" when direct host mounts are involved.

### Recommended end-to-end flow in simple terms

The ideal product flow looks like this:

1. user asks for work in the main `svvy` surface
2. orchestrator interprets the request and decides whether it is:
   - planning/read-only work
   - trusted local work
   - autonomous or higher-risk execution
3. if execution is needed, `svvy` creates a fresh sandbox with a known runtime profile
4. the repo enters that sandbox through an explicit mode:
   - direct local mount for trusted low-latency cases
   - copy-in / diff-out or worktree sync for autonomous cases
5. inside the sandbox, the task agent works through a typed work surface such as `execute_typescript`
6. host policy mediates the dangerous edges:
   - network access
   - secret injection
   - protected files
   - approval gates
7. the sandbox returns logs, artifacts, diffs, and Project CI results when the sandboxed work ran a declared CI entry
8. only after that does `svvy` sync approved changes back to the real workspace

The mental model is:

- brain: orchestrator
- workshop: sandbox runtime
- gatekeeper: host policy layer

### Recommended secret model

1. Do not place long-lived host credentials directly in task sandboxes by default.
2. Prefer per-run or per-thread credentials with narrow scopes and short lifetimes.
3. Prefer brokered outbound auth where possible.
4. Distinguish model-provider auth from tool-provider auth from git auth.

### Recommended trust model for repo assets

Before workspace trust is established, `svvy` should not auto-run or auto-load:

- `.svvy` workflow assets
- repo-local MCP server config
- hooks
- shell rc modifications
- repo-local approval or sandbox policies

After trust is established, these should still load through typed surfaces and actor-specific policy rather than ambient global execution.

### Recommended auditing and UX

`svvy` should make the boundary visible. For each execution surface, show:

- runtime class
- writable roots
- network policy
- whether secrets are present in guest
- whether workspace is mounted or copied
- what approvals are still required

This is both a security feature and a user-comprehension feature.

### Recommended evaluation plan

Before claiming strong sandboxing, `svvy` should maintain:

1. breakout and boundary tests
2. repo-trust regression tests
3. protected-path tests
4. egress-control tests
5. secret-exfiltration tests
6. actor-surface leakage tests

## Proposed Position for `svvy`

If `svvy` needs one short product stance, it should be:

`svvy` uses layered sandboxing: actor-specific capability policy on top of explicit execution runtimes. Trusted interactive local work uses a narrow local sandbox. Autonomous workflow work runs in isolated per-task environments with staged network access, scoped secrets, and durable audit trails.

That statement is much stronger and more precise than just saying "agents execute code in a sandboxed environment."

Another useful short version is:

`svvy` should let the model write code against narrow typed APIs, run that code inside an isolated task runtime, and keep secrets, egress, approvals, and sync-back under host policy rather than model control.

## Follow-up Questions

The research suggests several product decisions still need explicit resolution:

1. When should `svvy` prefer local worktree execution versus remote task sandboxes?
2. Will `execute_typescript` be a host API over the local machine, a guest API inside the sandbox, or a policy front-end that can target both?
3. Will handler threads own sandbox lifecycle directly, or will Smithers own the sandbox and expose it through `smithers.*` tools?
4. What is the minimum viable secret-brokering model for the first shipped version?
5. Which operations are never permitted from workflow task agents regardless of approval state?
6. What is the default sync mode for code changes produced by autonomous workflows?

## Source Index

### Product and provider sources

- OpenAI Codex
  - [Introducing Codex](https://openai.com/index/introducing-codex/)
  - [Codex CLI sandboxing](https://openai-codex.mintlify.app/concepts/sandboxing)
  - [Codex cloud internet access](https://developers.openai.com/codex/cloud/internet-access)
  - [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)
  - [Codex system card addendum](https://cdn.openai.com/pdf/8df7697b-c1b2-4222-be00-1fd3298f351d/codex_system_card.pdf)
- Anthropic Claude Code
  - [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing)
  - [Claude Code security](https://code.claude.com/docs/en/security)
  - [Claude Code auto mode config](https://code.claude.com/docs/en/auto-mode-config)
  - [Claude Code permission modes](https://code.claude.com/docs/en/permission-modes)
  - [Claude Code sandboxing engineering post](https://www.anthropic.com/engineering/claude-code-sandboxing)
- GitHub
  - [Copilot cloud agent overview](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)
  - [Copilot cloud agent firewall](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-firewall)
  - [Responsible use of Copilot cloud agent](https://docs.github.com/en/copilot/responsible-use/copilot-cloud-agent)
  - [GitHub Agentic Workflows network reference](https://github.github.com/gh-aw/reference/network/)
- VS Code and Cursor
  - [VS Code security for AI-powered development](https://code.visualstudio.com/docs/copilot/security)
  - [Cursor local sandboxing post](https://cursor.com/blog/agent-sandboxing)
- Code Mode / typed code execution
  - [TanStack Code Mode docs](https://tanstack.com/ai/latest/docs/code-mode/code-mode)
  - [TanStack Code Mode blog](https://tanstack.com/blog/tanstack-ai-code-mode)
  - [Cloudflare Dynamic Workers post](https://blog.cloudflare.com/dynamic-workers/)
  - [Cloudflare Code Mode docs](https://developers.cloudflare.com/agents/api-reference/codemode/)
  - [Anthropic code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp?_hsmi=390282592)
- Infrastructure providers
  - [Vercel Sandbox concepts](https://vercel.com/docs/vercel-sandbox/concepts)
  - [Vercel Sandbox firewall](https://vercel.com/docs/vercel-sandbox/concepts/firewall)
  - [Docker Sandboxes security model](https://docs.docker.com/ai/sandboxes/security/)
  - [Docker Sandboxes overview](https://docs.docker.com/ai/sandboxes/)
  - [E2B docs](https://www.e2b.dev/docs)
  - [E2B internet access](https://e2b.dev/docs/sandbox/internet-access)
  - [E2B coding agents](https://e2b.dev/docs/use-cases/coding-agents)
  - [Daytona sandboxes](https://www.daytona.io/docs/en/sandboxes/)
  - [Cloudflare Sandbox SDK](https://developers.cloudflare.com/sandbox/)
  - [Modal Sandboxes guide](https://modal.com/docs/guide/sandboxes)
  - [OpenHands Docker sandbox](https://docs.openhands.dev/openhands/usage/sandboxes/docker)
  - [OpenSandbox repository](https://github.com/alibaba/OpenSandbox)
  - [OpenSandbox architecture](https://open-sandbox.ai/overview/architecture)
  - [OpenSandbox secure runtime proposal](https://open-sandbox.ai/zh/oseps/0004-secure-container-runtime)
  - [OpenSandbox egress sidecar](https://open-sandbox.ai/components/egress/readme)
- Isolation primitives
  - [gVisor overview](https://gvisor.dev/docs/)
  - [gVisor intro](https://gvisor.dev/docs/architecture_guide/intro/)
  - [Firecracker overview](https://github.com/firecracker-microvm/firecracker)
  - [Firecracker jailer docs](https://github.com/firecracker-microvm/firecracker/blob/main/docs/jailer.md)
  - [Firecracker production host setup](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md)
  - [GKE Agent Sandbox guide](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/agent-sandbox)
  - [Zeroboot repository](https://github.com/zerobootdev/zeroboot)
  - [Hazmat repository](https://github.com/dredozubov/hazmat)

### Standards, governance, and research

- [OWASP Securing Agentic Applications Guide 1.0](https://genai.owasp.org/resource/securing-agentic-applications-guide-1-0/)
- [NIST lessons learned from tool use in agent systems](https://www.nist.gov/news-events/news/2025/08/lessons-learned-consortium-tool-use-agent-systems)
- [Microsoft Agent Governance Toolkit announcement](https://opensource.microsoft.com/blog/2026/04/02/introducing-the-agent-governance-toolkit-open-source-runtime-security-for-ai-agents/)
- [Microsoft Agent Governance Toolkit repository](https://github.com/microsoft/agent-governance-toolkit)
- [AISI SandboxEscapeBench](https://www.aisi.gov.uk/blog/can-ai-agents-escape-their-sandboxes-a-benchmark-for-safely-measuring-container-breakout-capabilities)

### Security incident reference

- [Check Point research on Claude Code flaws](https://blog.checkpoint.com/research/check-point-researchers-expose-critical-claude-code-flaws/)
