import { Clock, GitBranch, FileText } from "lucide-react";
import { StatusBadge } from "../StatusBadge";
import { ModelBadge } from "../ModelBadge";
import { usePanes } from "@/hooks/usePanes";
import type { SubagentItem, AgentType } from "@/data/mock";
import { Zap, Search, Code2, Eye, Workflow, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

const agentConfig: Record<AgentType, { icon: React.ElementType; label: string; color: string }> = {
  orchestrator: { icon: Bot, label: "orchestrator", color: "text-orange-400" },
  quick: { icon: Zap, label: "quick", color: "text-yellow-400" },
  explorer: { icon: Search, label: "explorer", color: "text-blue-400" },
  implementer: { icon: Code2, label: "implementer", color: "text-purple-400" },
  reviewer: { icon: Eye, label: "reviewer", color: "text-cyan-400" },
  "workflow-writer": { icon: Workflow, label: "workflow-writer", color: "text-slate-400" },
};

const liveOutputMap: Record<string, string> = {
  a1: `Implementing OAuth token refresh in src/utils/oauth.ts...

Reading current oauth.ts file (148 lines)
Reading types/oauth.ts for interface definitions
Reading tests/utils/oauth.test.ts for test patterns

Planning changes:
  - Add refreshToken(provider, refreshToken) function
  - Add isTokenExpired(token) helper
  - Export both from utils index

Writing implementation...
  ✓ Added refreshToken() with provider-specific endpoints
  ✓ Added isTokenExpired() with 60s buffer
  ✓ Updated exports in utils/index.ts
  ✓ Added JSDoc comments

Running targeted tests...
  ✓ test: refreshToken with valid refresh token
  ✓ test: refreshToken handles 401 response
  ✓ test: isTokenExpired returns true for expired tokens

Done. 3 tests passing. 62 lines added.`,
  a2: `Reviewing auth middleware for security vulnerabilities...

Reading src/middleware/auth.ts
Reading src/utils/jwt.ts
Reading src/utils/oauth.ts

Checking for common vulnerabilities:
  [x] Token validation — verifyToken uses asymmetric keys ✓
  [x] Header injection — x-oauth-provider sanitized ✓
  [x] Timing attacks — constant-time comparison used ✓
  [ ] Token scope validation — not implemented yet
  [ ] Rate limiting on failed auth — missing

Generating security report...

Recommendations:
  1. Add scope validation for OAuth tokens
  2. Add per-IP rate limiting for auth failures
  3. Consider adding token binding to prevent token theft

Reviewing diff for introduced issues...`,
  a3: `Exploring codebase for existing auth patterns...

Reading src/middleware/auth.ts
Reading src/utils/jwt.ts
Reading src/types/index.ts
Reading src/middleware/session.ts
Reading src/routes/auth.ts

Found existing patterns:
  - verifyToken() uses HS256 by default, not RS256
  - Session middleware stores user in req.session (not req.user)
  - Auth route /me returns full User object including password hash

Identified 3 integration points for OAuth:
  1. src/middleware/auth.ts — extend token verification
  2. src/routes/auth.ts — add /auth/callback/:provider route
  3. src/types/index.ts — extend User type with oauth fields

Summary ready.`,
};

const filesReadMap: Record<string, string[]> = {
  a1: ["src/utils/oauth.ts", "src/types/oauth.ts", "tests/utils/oauth.test.ts", "src/utils/index.ts"],
  a2: ["src/middleware/auth.ts", "src/utils/jwt.ts", "src/utils/oauth.ts", "src/types/oauth.ts"],
  a3: ["src/middleware/auth.ts", "src/utils/jwt.ts", "src/types/index.ts", "src/middleware/session.ts", "src/routes/auth.ts"],
};

const filesWrittenMap: Record<string, string[]> = {
  a1: ["src/utils/oauth.ts", "src/utils/index.ts"],
  a2: [],
  a3: [],
};

interface SubagentPaneContentProps {
  agent: SubagentItem;
}

export function SubagentPaneContent({ agent }: SubagentPaneContentProps) {
  const config = agentConfig[agent.type] || agentConfig.orchestrator;
  const Icon = config.icon;
  const liveOutput = liveOutputMap[agent.id] || "Waiting for output...";
  const filesRead = filesReadMap[agent.id] || [];
  const filesWritten = filesWrittenMap[agent.id] || [];

  return (
    <div className="flex flex-col h-full" data-testid={`subagent-pane-${agent.id}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0 bg-muted/20">
        <Icon className={cn("w-3 h-3", config.color)} />
        <span className={cn("font-mono text-[10px]", config.color)}>{config.label}</span>
        <StatusBadge status={agent.status} size="xs" />
        <div className="ml-auto flex items-center gap-2">
          <ModelBadge model={agent.model} size="xs" />
          <span className="font-mono text-[9px] text-muted-foreground flex items-center gap-1">
            <Clock className="w-2 h-2" />
            {agent.elapsed}
          </span>
          {agent.tokens && (
            <span className="font-mono text-[9px] text-muted-foreground">
              {(agent.tokens / 1000).toFixed(1)}k
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
          <pre className="font-mono text-[10px] leading-[1.7] text-foreground/75 whitespace-pre-wrap">
            {liveOutput}
            {agent.status === "running" && <span className="stream-cursor" />}
          </pre>
        </div>

        <div className="w-40 flex-shrink-0 border-l border-border overflow-y-auto scrollbar-thin py-2 px-2.5">
          <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Read</div>
          <div className="space-y-0.5 mb-3">
            {filesRead.map(f => (
              <div key={f} className="flex items-center gap-1">
                <FileText className="w-2 h-2 text-muted-foreground/50 flex-shrink-0" />
                <span className="font-mono text-[9px] text-muted-foreground truncate">{f.split("/").pop()}</span>
              </div>
            ))}
            {filesRead.length === 0 && (
              <span className="text-[9px] text-muted-foreground/40 italic">none</span>
            )}
          </div>

          <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Written</div>
          <div className="space-y-0.5">
            {filesWritten.map(f => (
              <div key={f} className="flex items-center gap-1">
                <FileText className="w-2 h-2 text-emerald-400/60 flex-shrink-0" />
                <span className="font-mono text-[9px] text-emerald-400/80 truncate">{f.split("/").pop()}</span>
              </div>
            ))}
            {filesWritten.length === 0 && (
              <span className="text-[9px] text-muted-foreground/40 italic">none</span>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-border px-3 py-2 flex items-center gap-2 flex-shrink-0">
        <button className="text-[10px] px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          Interrupt
        </button>
        <button className="text-[10px] px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          Add context
        </button>
      </div>
    </div>
  );
}
