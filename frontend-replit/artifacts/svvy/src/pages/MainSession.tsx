import { PaneSplitShell } from "@/components/svvy/PaneSplitShell";
import { ThreadCard } from "@/components/svvy/ThreadCard";
import { WorkflowCard } from "@/components/svvy/WorkflowCard";
import { EpisodeCard } from "@/components/svvy/EpisodeCard";
import { VerificationCard } from "@/components/svvy/VerificationCard";
import { WaitingCard } from "@/components/svvy/WaitingCard";
import { FailedCard } from "@/components/svvy/FailedCard";
import {
  mockThreads,
  mockSubagents,
  mockWorkflowRun,
  mockEpisodes,
  mockVerification,
  mockVerificationFailed,
} from "@/data/mock";

interface MainSessionProps {
  variant?: "default" | "inspector" | "active" | "waiting" | "failed";
}

const userMessages = [
  {
    id: "um1",
    text: "Implement OAuth 2.0 support with PKCE for GitHub and Google providers. Make sure the middleware handles token refresh and expired tokens gracefully.",
  },
];

const orchestratorMessages = [
  {
    id: "om1",
    text: "Understood. I'll implement OAuth 2.0 with PKCE for both providers. Breaking this into three threads: middleware implementation, integration tests, and security review.",
    bullets: [
      "Analyzing current auth structure and identifying integration points",
      "Planning PKCE flow for GitHub and Google providers",
      "Creating bounded threads for implementation and testing",
    ],
  },
];

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end" data-testid="user-message">
      <div className="max-w-xl bg-secondary/60 border border-border rounded px-3 py-2">
        <p className="text-[13px] text-foreground leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function OrchestratorMessage({ text, bullets }: { text: string; bullets?: string[] }) {
  return (
    <div data-testid="orchestrator-message">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">
          orchestrator
        </span>
        <span className="font-mono text-[9px] text-orange-400 border border-orange-500/20 bg-orange-500/8 rounded px-1 py-0.5">
          opus
        </span>
      </div>
      <p className="text-[13px] text-foreground leading-relaxed mb-2">{text}</p>
      {bullets && bullets.length > 0 && (
        <ul className="space-y-1">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
              <span className="text-muted-foreground/40 mt-0.5">·</span>
              {b}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MainSession({ variant = "default" }: MainSessionProps) {
  const showInspector = variant === "inspector";
  const isStreaming = variant === "active";
  const budgetPercent = variant === "active" ? 71 : variant === "failed" ? 88 : 42;
  const threadList =
    variant === "waiting" ? [mockThreads[2], mockThreads[1]] : [mockThreads[0], mockThreads[1]];

  return (
    <PaneSplitShell
      title="OAuth Provider Integration"
      sessionStatus={
        variant === "waiting" ? "waiting" : variant === "failed" ? "failed" : "running"
      }
      worktree="feat/oauth-provider"
      budgetPercent={budgetPercent}
      isStreaming={isStreaming}
      showInspector={showInspector}
    >
      <div className="px-5 py-4 space-y-4 max-w-3xl">
        <UserMessage text={userMessages[0].text} />

        <OrchestratorMessage
          text={orchestratorMessages[0].text}
          bullets={orchestratorMessages[0].bullets}
        />

        <div className="border-t border-border/40" />

        {threadList.map((thread, index) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            subagents={
              index === 0
                ? [mockSubagents[0], mockSubagents[2]]
                : variant === "active"
                  ? [mockSubagents[1]]
                  : []
            }
          />
        ))}

        <EpisodeCard episode={mockEpisodes[0]} />

        {variant !== "failed" && <VerificationCard result={mockVerification} />}

        {variant === "failed" && (
          <FailedCard
            testsPassed={mockVerificationFailed.testsPassed}
            testsTotal={mockVerificationFailed.testsTotal}
            errorSnippet={mockVerificationFailed.errorSnippet}
          />
        )}

        {(variant === "active" || variant === "default") && (
          <WorkflowCard workflow={mockWorkflowRun} />
        )}

        {variant === "waiting" && (
          <WaitingCard
            question="Should the OAuth middleware handle token refresh automatically, or return a 401 with a refresh hint header for the client to handle?"
            context="Implementing token expiry handling in auth.ts. Two approaches available."
          />
        )}

        {isStreaming && (
          <div className="text-[13px] text-foreground/80 leading-relaxed">
            <span className="font-mono text-[9px] text-muted-foreground block mb-1.5 uppercase tracking-wider">
              orchestrator
            </span>
            Now delegating integration test writing to the implementer subagent. I'll review the
            test coverage once the initial suite is written
            <span className="stream-cursor" />
          </div>
        )}
      </div>
    </PaneSplitShell>
  );
}
