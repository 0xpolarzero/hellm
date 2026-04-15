import { useState } from "react";
import { DiffViewer } from "../DiffViewer";
import { ArtifactBrowser } from "../ArtifactBrowser";
import type { ArtifactItem } from "@/data/mock";
import { GitBranch, FileText, Image, BarChart2, FileCode, FileJson } from "lucide-react";
import { cn } from "@/lib/utils";

const typeIcons: Record<string, React.ElementType> = {
  diff: GitBranch,
  log: FileText,
  screenshot: Image,
  report: BarChart2,
  html: FileCode,
  json: FileJson,
};

const logContent = `[14:03:22] Starting test suite...
[14:03:23] PASS  auth/login.test.ts
[14:03:23]   ✓ should login with valid credentials (42ms)
[14:03:23]   ✓ should reject invalid password (11ms)
[14:03:24] PASS  auth/middleware.test.ts
[14:03:24]   ✓ should attach user to request (18ms)
[14:03:24]   ✓ should reject expired token (12ms)
[14:03:24]   ✓ should reject malformed token (9ms)
[14:03:25] PASS  oauth/github.test.ts
[14:03:25]   ✓ should exchange code for token (66ms)
[14:03:26] PASS  oauth/google.test.ts
[14:03:26]   ✓ should verify PKCE challenge (44ms)
[14:03:27] Tests: 12 passed, 12 total
[14:03:27] Time:  4.821s`;

const jsonContent = `{
  "lintResults": {
    "errorCount": 0,
    "warningCount": 2,
    "files": [
      {
        "filePath": "src/middleware/auth.ts",
        "messages": [
          {
            "ruleId": "no-unused-vars",
            "severity": 1,
            "message": "'OAuthProvider' is defined but never used",
            "line": 3,
            "column": 10
          }
        ]
      }
    ]
  },
  "summary": { "passed": true, "errors": 0, "warnings": 2 }
}`;

interface ArtifactPaneContentProps {
  artifact?: ArtifactItem;
  showBrowser?: boolean;
}

export function ArtifactPaneContent({ artifact, showBrowser = false }: ArtifactPaneContentProps) {
  const [tab, setTab] = useState<"preview" | "metadata">("preview");

  if (showBrowser || !artifact) {
    return (
      <div className="h-full">
        <ArtifactBrowser />
      </div>
    );
  }

  const Icon = typeIcons[artifact.type] || FileText;

  return (
    <div className="flex flex-col h-full" data-testid={`artifact-pane-${artifact.id}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0 bg-muted/20">
        <Icon className="w-3 h-3 text-muted-foreground" />
        <span className="font-mono text-[11px] text-foreground/90 flex-1 truncate">{artifact.name}</span>
        <div className="flex items-center gap-0.5">
          {(["preview", "metadata"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded capitalize transition-colors",
                tab === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <span className="font-mono text-[9px] text-muted-foreground">{artifact.size}</span>
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "preview" && (
          <>
            {artifact.type === "diff" && <DiffViewer filename={artifact.name} />}
            {artifact.type === "log" && (
              <pre className="font-mono text-[10px] leading-relaxed text-foreground/75 overflow-auto scrollbar-thin p-3 h-full">
                {logContent}
              </pre>
            )}
            {artifact.type === "json" && (
              <pre className="font-mono text-[10px] leading-relaxed text-foreground/75 overflow-auto scrollbar-thin p-3 h-full">
                {jsonContent}
              </pre>
            )}
            {(artifact.type === "screenshot" || artifact.type === "html" || artifact.type === "report") && (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                  <Icon className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <span className="text-[11px]">Preview not available</span>
                </div>
              </div>
            )}
          </>
        )}
        {tab === "metadata" && (
          <div className="p-3 space-y-2">
            <MetaRow label="Name" value={artifact.name} />
            <MetaRow label="Type" value={artifact.type.toUpperCase()} />
            <MetaRow label="Size" value={artifact.size} />
            <MetaRow label="Created" value={artifact.age} />
            <MetaRow label="Session" value={artifact.session} />
          </div>
        )}
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[10px] text-foreground/80">{value}</span>
    </div>
  );
}
