import { useState } from "react";
import {
  X,
  GitBranch,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  FolderTree,
  PanelRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import { ModelBadge } from "./ModelBadge";
import { ArtifactChip } from "./ArtifactChip";
import {
  mockArtifacts,
  mockEpisodes,
  mockPaneSurfaces,
  mockThreads,
  mockVerification,
} from "@/data/mock";

interface RightInspectorProps {
  open: boolean;
  onClose: () => void;
}

type InspectorTab = "thread" | "episode" | "artifact" | "workflow" | "verification";

export function RightInspector({ open, onClose }: RightInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("thread");
  const thread = mockThreads[0];
  const episode = mockEpisodes[0];
  const artifact = mockArtifacts[0];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 320, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          className="flex-shrink-0 border-l border-border bg-card h-full flex flex-col overflow-hidden"
          data-testid="right-inspector"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-1">
              {(
                ["thread", "episode", "artifact", "workflow", "verification"] as InspectorTab[]
              ).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "text-[11px] px-2 py-1 rounded capitalize transition-colors",
                    activeTab === tab
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                  )}
                  data-testid={`inspector-tab-${tab}`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid="inspector-close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-3 space-y-4">
            {activeTab === "thread" && <ThreadInspector thread={thread} />}
            {activeTab === "episode" && <EpisodeInspector episode={episode} />}
            {activeTab === "artifact" && <ArtifactInspector artifact={artifact} />}
            {activeTab === "workflow" && <WorkflowInspectorPanel />}
            {activeTab === "verification" && <VerificationInspectorPanel />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
        {title}
      </h4>
      {children}
    </div>
  );
}

function ThreadInspector({ thread }: { thread: (typeof mockThreads)[0] }) {
  return (
    <>
      <div>
        <div className="flex items-start gap-2 mb-2">
          <StatusBadge status={thread.status} size="sm" />
          <h3 className="text-[13px] font-medium text-foreground leading-tight">{thread.title}</h3>
        </div>
        <p className="text-[12px] text-muted-foreground leading-relaxed">{thread.objective}</p>
      </div>

      <InspectorSection title="Changed Files">
        <div className="space-y-1">
          {thread.changedFiles?.map((f) => (
            <div key={f} className="flex items-center gap-1.5 py-0.5">
              <FileText className="w-2.5 h-2.5 text-muted-foreground flex-shrink-0" />
              <span className="font-mono text-[10px] text-foreground/80 truncate">{f}</span>
            </div>
          ))}
        </div>
      </InspectorSection>

      {thread.conclusions && thread.conclusions.length > 0 && (
        <InspectorSection title="Conclusions">
          <div className="space-y-1">
            {thread.conclusions.map((c, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                <span className="text-[12px] text-foreground/80 leading-relaxed">{c}</span>
              </div>
            ))}
          </div>
        </InspectorSection>
      )}

      {thread.unresolvedIssues && thread.unresolvedIssues.length > 0 && (
        <InspectorSection title="Unresolved Issues">
          <div className="space-y-1">
            {thread.unresolvedIssues.map((issue, i) => (
              <div
                key={i}
                className="flex items-start gap-1.5 px-2 py-1.5 rounded bg-amber-500/8 border border-amber-500/15"
              >
                <AlertTriangle className="w-2.5 h-2.5 text-amber-400 flex-shrink-0 mt-0.5" />
                <span className="text-[11px] text-amber-300 leading-relaxed">{issue}</span>
              </div>
            ))}
          </div>
        </InspectorSection>
      )}

      {thread.followUpSuggestions && thread.followUpSuggestions.length > 0 && (
        <InspectorSection title="Follow-up Suggestions">
          <div className="space-y-1">
            {thread.followUpSuggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <Lightbulb className="w-2.5 h-2.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <span className="text-[11px] text-muted-foreground leading-relaxed">{s}</span>
              </div>
            ))}
          </div>
        </InspectorSection>
      )}

      <InspectorSection title="Provenance">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Worktree</span>
            <span className="font-mono text-[10px] text-foreground/70 flex items-center gap-1">
              <GitBranch className="w-2 h-2" />
              {thread.worktree}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Elapsed</span>
            <span className="font-mono text-[10px] text-foreground/70">{thread.elapsed}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Model</span>
            <ModelBadge model={thread.model} size="xs" />
          </div>
        </div>
      </InspectorSection>
    </>
  );
}

function EpisodeInspector({ episode }: { episode: (typeof mockEpisodes)[0] }) {
  return (
    <>
      <div>
        <div className="flex items-start gap-2 mb-2">
          <StatusBadge status={episode.verified ? "done" : "waiting"} size="sm" />
          <h3 className="text-[13px] font-medium text-foreground leading-tight">{episode.title}</h3>
        </div>
        <p className="text-[12px] text-muted-foreground leading-relaxed">{episode.summary}</p>
      </div>

      <InspectorSection title="Artifacts">
        <div className="flex flex-wrap gap-1.5">
          {episode.artifacts.map((a) => (
            <ArtifactChip key={a.id} name={a.name} type={a.type} />
          ))}
        </div>
      </InspectorSection>

      <InspectorSection title="Verification">
        <div
          className={cn(
            "px-2 py-2 rounded border flex items-center gap-2",
            episode.verified
              ? "bg-emerald-500/8 border-emerald-500/15"
              : "bg-red-500/8 border-red-500/15",
          )}
        >
          <CheckCircle2
            className={cn("w-3.5 h-3.5", episode.verified ? "text-emerald-500" : "text-red-500")}
          />
          <span
            className={cn("text-[12px]", episode.verified ? "text-emerald-400" : "text-red-400")}
          >
            {episode.verified ? "All checks passed" : "Verification failed"}
          </span>
        </div>
      </InspectorSection>

      <InspectorSection title="Provenance">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Thread</span>
            <span className="text-[11px] text-foreground/70">{episode.thread}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Worktree</span>
            <span className="font-mono text-[10px] text-foreground/70 flex items-center gap-1">
              <GitBranch className="w-2 h-2" />
              {episode.worktree}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Model</span>
            <ModelBadge model={episode.model} size="xs" />
          </div>
        </div>
      </InspectorSection>
    </>
  );
}

function ArtifactInspector({ artifact }: { artifact: (typeof mockArtifacts)[0] }) {
  return (
    <>
      <div>
        <div className="flex items-center gap-2 mb-2">
          <ArtifactChip name={artifact.name} type={artifact.type} />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Session</span>
            <span className="text-[11px] text-foreground/70 truncate max-w-40">
              {artifact.session}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Size</span>
            <span className="font-mono text-[10px] text-foreground/70">{artifact.size}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Created</span>
            <span className="font-mono text-[10px] text-foreground/70">{artifact.age}</span>
          </div>
        </div>
      </div>

      <InspectorSection title="Preview">
        <div className="rounded border border-border bg-muted/30 p-2 text-[10px] font-mono text-muted-foreground h-32 overflow-hidden">
          <div className="diff-header">--- a/src/middleware/auth.ts</div>
          <div className="diff-header">+++ b/src/middleware/auth.ts</div>
          <div className="diff-header">@@ -1,15 +1,28 @@</div>
          <div className="diff-context">
            {" "}
            import {"{"} Request, Response {"}"} from 'express';
          </div>
          <div className="diff-remove">
            -import {"{"} verifyToken {"}"} from '../utils/jwt';
          </div>
          <div className="diff-add">
            +import {"{"} verifyToken, extractOAuthToken {"}"} from '../utils/jwt';
          </div>
          <div className="diff-add">
            +import {"{"} OAuthProvider {"}"} from '../types/oauth';
          </div>
          <div className="diff-context"> </div>
          <div className="diff-context"> export const authMiddleware = async (</div>
        </div>
      </InspectorSection>

      <button
        className="w-full text-[11px] py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        data-testid="btn-open-artifact"
      >
        Open in pane
      </button>
    </>
  );
}

function WorkflowInspectorPanel() {
  return (
    <>
      <div>
        <h3 className="text-[13px] font-medium text-foreground mb-1">auth-refactor-ci</h3>
        <span className="font-mono text-[10px] text-muted-foreground">run_j4k2m9</span>
      </div>

      <InspectorSection title="Progress">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Steps</span>
            <span className="font-mono text-[10px] text-foreground/70">3 / 8</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Elapsed</span>
            <span className="font-mono text-[10px] text-foreground/70">2m 04s</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Current step</span>
            <span className="font-mono text-[10px] text-orange-400">run-tests</span>
          </div>
        </div>
      </InspectorSection>

      <InspectorSection title="Pane surfaces">
        <div className="space-y-1">
          {mockPaneSurfaces.map((surface) => (
            <div
              key={surface.id}
              className="flex items-center justify-between rounded border border-border px-2 py-1.5"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <PanelRight className="w-2.5 h-2.5 text-muted-foreground flex-shrink-0" />
                <span className="text-[11px] text-foreground/80 truncate">{surface.label}</span>
              </div>
              <span className="font-mono text-[9px] text-muted-foreground">
                {surface.positions.join(" ")}
              </span>
            </div>
          ))}
        </div>
      </InspectorSection>
    </>
  );
}

function VerificationInspectorPanel() {
  return (
    <>
      <div>
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          <h3 className="text-[13px] font-medium text-foreground">Latest verification</h3>
        </div>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          {mockVerification.summary}
        </p>
      </div>

      <InspectorSection title="Checks">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Build</span>
            <span className="font-mono text-[10px] text-emerald-400">{mockVerification.build}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Tests</span>
            <span className="font-mono text-[10px] text-emerald-400">
              {mockVerification.testsPassed}/{mockVerification.testsTotal}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Lint</span>
            <span className="font-mono text-[10px] text-emerald-400">{mockVerification.lint}</span>
          </div>
        </div>
      </InspectorSection>

      <InspectorSection title="Artifacts">
        <div className="space-y-1">
          {mockVerification.artifacts?.map((artifact) => (
            <div
              key={artifact.id}
              className="flex items-center justify-between rounded border border-border px-2 py-1.5"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <FileText className="w-2.5 h-2.5 text-muted-foreground flex-shrink-0" />
                <span className="text-[11px] text-foreground/80 truncate">{artifact.name}</span>
              </div>
              <span className="font-mono text-[9px] text-muted-foreground">{artifact.size}</span>
            </div>
          ))}
        </div>
      </InspectorSection>

      <InspectorSection title="Projection">
        <div className="rounded border border-border px-2.5 py-2 bg-muted/20">
          <div className="flex items-center gap-1.5 mb-1.5">
            <FolderTree className="w-3 h-3 text-muted-foreground" />
            <span className="text-[11px] text-foreground/80">Durable state summary</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Verification is linked to the session timeline, inspector, and artifact browser instead
            of relying on transcript parsing.
          </p>
        </div>
      </InspectorSection>
    </>
  );
}
