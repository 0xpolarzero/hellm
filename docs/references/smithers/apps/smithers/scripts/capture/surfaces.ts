/**
 * Surface manifest for the validation slideshow capture pipeline.
 *
 * Each entry describes one feature of the Smithers PWA and how the capture
 * script should reach it:
 *
 * - id            kebab-case, used as the screenshot/gif filename and slide id
 * - title         human label for the slideshow heading
 * - kind          how to arrive: a route URL, a slash command typed into the
 *                 composer, or a free-form sequence of steps
 * - path          for kind === "route" — the URL path
 * - command       for kind === "slash" — the slash text typed into the composer
 * - waitFor       optional selector that must be visible before capturing
 * - description   short feature summary printed on the slide
 * - validation    notes about what the corresponding playwright spec proves
 * - motion        phase-by-phase recipe for interaction sequences. Each phase
 *                 runs its steps, waits for its selector, then snapshots a
 *                 frame. Used by the onboarding splash → welcome → builder
 *                 sequence so each frame is anchored on a real DOM state
 *                 instead of a blind setTimeout.
 *
 * The order here is the order surfaces appear in the slideshow. Keeping the
 * manifest as plain data lets unit tests (and the slideshow generator) iterate
 * without touching the page driver.
 */

export type SurfaceCapture =
  | { kind: "route"; path: string }
  | { kind: "slash"; command: string; expectPath?: RegExp }
  | { kind: "steps"; steps: CaptureStep[] };

export type CaptureStep =
  | { do: "goto"; path: string }
  | { do: "fill"; selector: string; value: string }
  | { do: "press"; selector: string; key: string }
  | { do: "click"; selector: string }
  | { do: "wait"; selector: string };

export type SurfaceEntry = {
  id: string;
  title: string;
  capture: SurfaceCapture;
  waitFor?: string;
  description: string;
  validation: string;
  /** When true, also capture a mobile (390x844) variant. Default true. */
  mobile?: boolean;
  /** When true, also capture a dark-theme variant. Default true. */
  dark?: boolean;
  /** Optional interaction sequence — one named frame per phase. */
  motion?: MotionCapture;
};

export type MotionCapture = {
  /** Phases captured in order. Each one waits for its selector before snapping. */
  phases: MotionPhase[];
};

export type MotionPhase = {
  /** Short id used in the frame filename (e.g. "intro", "welcome", "build"). */
  id: string;
  /** Optional setup steps run before this phase's wait. */
  steps?: CaptureStep[];
  /** Selector that must be present (and visible) before snapshotting. */
  waitFor: string;
  /** Human label used in manifest + deck captions. */
  label: string;
};

/**
 * Surfaces, in slideshow order. Routes first, then slash commands, then
 * interactive flows. Empty/error/long-label states use the manifest's `id`
 * suffix conventions (e.g. `-empty`, `-long`) so the generator can group them.
 */
export const SURFACES: SurfaceEntry[] = [
  // --- Shell & home ---------------------------------------------------------
  {
    id: "home",
    title: "Home — composer & hero",
    capture: { kind: "route", path: "/" },
    waitFor: 'input[aria-label="Message Smithers"]',
    description:
      "Centered chat-first shell. The composer is the entry point for every feature; slash commands open cards or canvases without leaving home.",
    validation:
      "tests/e2e/smoke.spec.ts — boots without uncaught errors; composer + hero render.",
  },
  {
    id: "store",
    title: "Workflow store",
    capture: { kind: "route", path: "/store" },
    description:
      "Browse and pick from the workflow app store. Each card opens a workflow editor or launches a run.",
    validation:
      "tests/e2e/store.spec.ts — store route renders the catalog and lets users open a workflow.",
  },
  {
    id: "askme",
    title: "Ask Me",
    capture: { kind: "route", path: "/askme" },
    description:
      "Reverse interview: Smithers grills you to sharpen an idea before you commit to a workflow.",
    validation:
      "tests/e2e/askme.spec.ts — opens askme route and walks through the grill prompts.",
  },

  // --- Canvas surfaces (top-level) ------------------------------------------
  {
    id: "runs",
    title: "Runs list",
    capture: { kind: "route", path: "/runs" },
    waitFor: "main",
    description:
      "Every recent workflow execution. Each row drills into the run inspector, logs, timeline, diff, and changes.",
    validation:
      "tests/e2e/runsCanvas.spec.ts — `/runs` surface renders rows; row navigation lands on the inspector.",
  },
  {
    id: "approvals",
    title: "Approvals queue",
    capture: { kind: "route", path: "/approvals" },
    description:
      "Pending human-gate approvals across runs. Approve/deny inline; live-updated via the gateway.",
    validation: "tests/e2e/approvals.spec.ts — pending gates list and approve/deny actions work.",
  },
  {
    id: "agents",
    title: "Agents & providers",
    capture: { kind: "route", path: "/agents" },
    description:
      "Registry of every agent the workspace can talk to. Each row shows availability and the underlying provider.",
    validation:
      "tests/e2e/featureCards.spec.ts → /agents card — provider availability counts match the catalog.",
  },
  {
    id: "memory",
    title: "Memory",
    capture: { kind: "route", path: "/memory" },
    description:
      "Cross-run memory facts with namespaces, recall search, and per-fact detail panes.",
    validation: "tests/e2e/featureCards.spec.ts → /memory card — recall hits the seeded fact set.",
  },
  {
    id: "prompts",
    title: "Prompts",
    capture: { kind: "route", path: "/prompts" },
    description:
      "All prompt templates in the workspace, sourced from PROMPT_TEMPLATES with their imports inlined.",
    validation: "tests/e2e/featureCards.spec.ts → /prompts card — templates render with imports.",
  },
  {
    id: "scores",
    title: "Scores",
    capture: { kind: "route", path: "/scores" },
    description:
      "Scorer dashboard. Summary, metrics, and recent reports tabs; empty-state when nothing has run.",
    validation: "tests/e2e/featureCards.spec.ts → /scores card — score report rows render.",
  },
  {
    id: "crons",
    title: "Crons",
    capture: { kind: "route", path: "/crons" },
    description:
      "Scheduled triggers. Each cron summary is derived from SEEDED_CRONS — adding a cron updates the list.",
    validation: "tests/e2e/featureCards.spec.ts → /crons card — sorted cron summary lines up.",
  },
  {
    id: "issues",
    title: "Issues",
    capture: { kind: "route", path: "/issues" },
    description:
      "Code-host issues mocked from the vcs template. Filter by state/labels; opens detail in a side rev.",
    validation: "tests/e2e/reviewSurfaces.spec.ts — `/issues` renders and filters correctly.",
  },
  {
    id: "tickets",
    title: "Tickets",
    capture: { kind: "route", path: "/tickets" },
    description:
      "Linear-style ticket queue with status pills and assignee chips. Drills into a ticket detail view.",
    validation: "tests/e2e/reviewSurfaces.spec.ts — `/tickets` rows render with status pills.",
  },
  {
    id: "landings",
    title: "Landings",
    capture: { kind: "route", path: "/landings" },
    description:
      "Pull-request landings feed. Filter by repo / state; preview the changed surface.",
    validation: "tests/e2e/reviewSurfaces.spec.ts — `/landings` filter segment toggles state.",
  },
  {
    id: "vcs",
    title: "Changes (VCS)",
    capture: { kind: "route", path: "/vcs" },
    description:
      "Working-tree changes across the project, grouped by repo. Pairs with the diff viewer.",
    validation: "tests/e2e/diffVcs.spec.ts — `/vcs` lists changed files; opens the diff.",
  },
  {
    id: "palette",
    title: "Palette",
    capture: { kind: "route", path: "/palette" },
    description:
      "Command palette modal hosted as a route. Keyboard-first launcher for any feature.",
    validation:
      "tests/e2e/featureCards.spec.ts → palette — opens the palette modal from /palette.",
  },

  // --- Slash-driven flows (auto-launch a run) -------------------------------
  {
    id: "logs",
    title: "Run logs (transcript)",
    capture: { kind: "slash", command: "/logs", expectPath: /^\/runs\/[^/]+\/logs$/ },
    waitFor: '[data-testid="logs-canvas"]',
    description:
      "Live transcript canvas for the latest run. Stream of log lines with a toolbar; auto-launches a run if none exists.",
    validation: "tests/e2e/surfaces.spec.ts — `/logs` opens the logs canvas with log lines.",
  },
  {
    id: "timeline",
    title: "Time-travel timeline",
    capture: { kind: "slash", command: "/timeline", expectPath: /^\/runs\/[^/]+\/timeline$/ },
    waitFor: '[data-testid="timeline-canvas"]',
    description:
      "Time-travel scrubber. Each frame is a snapshot of the run; click to rewind or fork.",
    validation:
      "tests/e2e/surfaces.spec.ts — `/timeline` renders the scrubber, banner, and frame buttons.",
  },
  {
    id: "diff",
    title: "Diff Viewer",
    capture: { kind: "slash", command: "/diff auth" },
    waitFor: '[data-testid="diff-card"]',
    description: "Inline diff viewer card showing file hunks and delta counts.",
    validation: "tests/e2e/diffVcs.spec.ts — `/diff` slash command renders the diff card.",
  },
  {
    id: "workflow-editor",
    title: "Workflow Editor",
    capture: { kind: "route", path: "/store/review-cycle" },
    waitFor: ".cm-content",
    description: "Code mirror canvas to read and modify a workflow plan.",
    validation: "tests/e2e/workflowEditor.spec.ts — workflow editor renders and accepts input.",
  },

  // --- Gateway & Integrations -----------------------------------------------
  {
    id: "gateway-custom-ui",
    title: "Gateway Custom UI (Vanilla)",
    capture: { kind: "route", path: "/gw/demo-ui/demo-ui-run-1" },
    waitFor: '[data-testid="gateway-run-inspector"]',
    description: "Embedded custom workflow UI served by the gateway. Replaces the native inspector.",
    validation: "tests/e2e/gatewayUi.spec.ts — embeds the custom UI and toggles to the native inspector.",
  },
  {
    id: "gateway-react-ui",
    title: "Gateway Custom UI (React)",
    capture: { kind: "route", path: "/gw/demo-react-ui/demo-react-ui-run-1" },
    waitFor: '[data-testid="gateway-run-inspector"]',
    description: "React-based custom workflow UI served by the gateway.",
    validation: "tests/e2e/gatewayReactUi.spec.ts — embeds the React bundle and reads live run + node output.",
  },
  {
    id: "sync-sdk",
    title: "Gateway Sync SDK",
    capture: {
      kind: "steps",
      steps: [
        { do: "goto", path: "/gw/demo-ui/demo-ui-run-1" },
        { do: "click", selector: '[data-testid="gateway-view-inspector"]' },
      ],
    },
    waitFor: '[data-testid="tree-row-plan"]',
    description: "Live-data sync over WebSocket for a remote workflow run.",
    validation: "tests/e2e/gatewaySdk.spec.ts — opens a /v1/rpc WebSocket and streams run state.",
  },
  {
    id: "plue-harness",
    title: "Plue Harness API",
    capture: { kind: "route", path: "/api/user/repos" },
    description: "Local fake-Plue server proxy endpoint for e2e tests.",
    validation: "tests/e2e/plueHarness.spec.ts — resolves seeded fake data through the Vite proxy.",
  },
  {
    id: "observability",
    title: "Observability Metrics",
    capture: { kind: "route", path: "/metrics" },
    description: "Prometheus text exposition endpoint for worker metrics.",
    validation: "tests/e2e/observability.spec.ts — worker exposes documented metric names.",
  },

  // --- Auth -----------------------------------------------------------------
  {
    id: "login",
    title: "Sign in",
    capture: { kind: "route", path: "/login" },
    description:
      "Sign-in page. Used when entering the remote-mode wiring; otherwise the app runs fully local.",
    validation: "tests/e2e/auth.spec.ts — login form mounts and validates basic input.",
  },

  // --- Onboarding (motion sequence) -----------------------------------------
  // The seed script removes the persisted `smithers.onboarding` flag for this
  // surface, so the very first paint at "/" lands on the splash overlay. The
  // motion phases then drive the real overlay forward through the welcome
  // dialog and into the live workflow graph, anchored on selectors the
  // onboarding e2e spec also uses.
  {
    id: "onboarding",
    title: "First-run onboarding",
    capture: {
      kind: "steps",
      steps: [{ do: "goto", path: "/" }],
    },
    description:
      "First-run flow. Splash → goal capture → live workflow graph proposal. Replayable via `/onboarding`.",
    validation:
      "tests/e2e/onboarding.spec.ts — three phases render and the created workflow primes the composer.",
    motion: {
      phases: [
        {
          id: "intro",
          label: "Splash mark",
          waitFor: ".ob-intro .ob-mark",
        },
        {
          id: "welcome",
          label: "Welcome dialog",
          steps: [{ do: "click", selector: ".ob-begin" }],
          waitFor: '[role="dialog"][aria-label="Welcome to Smithers"] .ob-goal-input',
        },
        {
          id: "build",
          label: "Workflow proposal",
          steps: [
            {
              do: "fill",
              selector: '[aria-label="What would you like a workflow to do?"]',
              value: "ship the billing page",
            },
            { do: "click", selector: ".ob-goal-send" },
          ],
          waitFor: ".ob-graph .node-title",
        },
      ],
    },
  },
];

export type ThemeVariant = "light" | "dark";
export type DeviceVariant = "desktop" | "mobile";

export type CaptureVariant = {
  theme: ThemeVariant;
  device: DeviceVariant;
};

export const DEFAULT_VARIANTS: CaptureVariant[] = [
  { theme: "light", device: "desktop" },
  { theme: "dark", device: "desktop" },
  { theme: "light", device: "mobile" },
];
