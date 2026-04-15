import { useState } from "react";
import { cn } from "@/lib/utils";
import { FileText, GitBranch, Image, BarChart2, FileCode, FileJson, ChevronRight, ChevronDown } from "lucide-react";
import { DiffViewer } from "./DiffViewer";
import { mockArtifacts } from "@/data/mock";
import type { ArtifactItem, ArtifactType } from "@/data/mock";

const typeIcons: Record<ArtifactType, React.ElementType> = {
  diff: GitBranch,
  log: FileText,
  screenshot: Image,
  report: BarChart2,
  html: FileCode,
  json: FileJson,
};

const typeColors: Record<ArtifactType, string> = {
  diff: "text-blue-400",
  log: "text-slate-400",
  screenshot: "text-purple-400",
  report: "text-cyan-400",
  html: "text-orange-400",
  json: "text-yellow-400",
};

function LogPreview() {
  return (
    <pre className="font-mono text-[10px] leading-relaxed text-foreground/70 overflow-auto scrollbar-thin p-3 h-full">
{`[14:03:22] Starting test suite...
[14:03:22] Environment: test
[14:03:22] Database: in-memory
[14:03:23] PASS  auth/login.test.ts
[14:03:23]   ✓ should login with valid credentials (42ms)
[14:03:23]   ✓ should reject invalid password (11ms)
[14:03:23]   ✓ should reject missing credentials (8ms)
[14:03:24] PASS  auth/middleware.test.ts
[14:03:24]   ✓ should attach user to request (18ms)
[14:03:24]   ✓ should reject expired token (12ms)
[14:03:24]   ✓ should reject malformed token (9ms)
[14:03:24]   ✓ should handle Bearer prefix (7ms)
[14:03:25] PASS  oauth/github.test.ts
[14:03:25]   ✓ should exchange code for token (66ms)
[14:03:25]   ✓ should handle token refresh (28ms)
[14:03:25]   ✓ should handle revoked tokens (15ms)
[14:03:26] PASS  oauth/google.test.ts
[14:03:26]   ✓ should verify PKCE challenge (44ms)
[14:03:26]   ✓ should fetch user profile (38ms)
[14:03:27] Test Suites: 4 passed, 4 total
[14:03:27] Tests:       12 passed, 12 total
[14:03:27] Snapshots:   0 total
[14:03:27] Time:        4.821s`}
    </pre>
  );
}

function JsonPreview() {
  return (
    <pre className="font-mono text-[10px] leading-relaxed text-foreground/70 overflow-auto scrollbar-thin p-3 h-full">
{`{
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
        ],
        "errorCount": 0,
        "warningCount": 1
      }
    ]
  },
  "summary": {
    "passed": true,
    "errors": 0,
    "warnings": 2
  }
}`}
    </pre>
  );
}

interface ArtifactBrowserProps {
  className?: string;
}

export function ArtifactBrowser({ className }: ArtifactBrowserProps) {
  const [selected, setSelected] = useState<ArtifactItem>(mockArtifacts[0]);
  const [activeTab, setActiveTab] = useState<"preview" | "raw" | "metadata">("preview");

  const grouped = mockArtifacts.reduce((acc, a) => {
    if (!acc[a.session]) acc[a.session] = [];
    acc[a.session].push(a);
    return acc;
  }, {} as Record<string, ArtifactItem[]>);

  return (
    <div className={cn("flex h-full", className)} data-testid="artifact-browser">
      {/* File tree */}
      <div className="w-64 flex-shrink-0 border-r border-border overflow-y-auto scrollbar-thin py-2">
        {Object.entries(grouped).map(([session, artifacts]) => (
          <div key={session}>
            <div className="flex items-center gap-1 px-3 py-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              <ChevronDown className="w-2.5 h-2.5" />
              {session.length > 20 ? session.slice(0, 20) + "…" : session}
            </div>
            {artifacts.map(a => {
              const Icon = typeIcons[a.type] || FileText;
              const isSelected = selected.id === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setSelected(a)}
                  className={cn(
                    "w-full flex items-center gap-2 px-4 py-1.5 text-left transition-colors",
                    isSelected
                      ? "bg-secondary text-foreground"
                      : "text-foreground/70 hover:bg-secondary/50"
                  )}
                  data-testid={`artifact-row-${a.id}`}
                >
                  <Icon className={cn("w-3 h-3 flex-shrink-0", typeColors[a.type])} />
                  <span className="font-mono text-[11px] truncate flex-1">{a.name}</span>
                  <span className="font-mono text-[9px] text-muted-foreground">{a.size}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Preview panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tabs + meta */}
        <div className="flex items-center gap-3 px-3 py-2 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-0.5">
            {(["preview", "raw", "metadata"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "text-[11px] px-2.5 py-1 rounded capitalize transition-colors",
                  activeTab === tab
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                data-testid={`artifact-tab-${tab}`}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="font-mono text-[10px] text-muted-foreground">{selected.size}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{selected.age}</span>
          </div>
        </div>

        {/* Preview content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "preview" && (
            <>
              {selected.type === "diff" && <DiffViewer filename={selected.name} />}
              {selected.type === "log" && <LogPreview />}
              {selected.type === "json" && <JsonPreview />}
              {selected.type === "screenshot" && (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <Image className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <span className="text-[12px]">Screenshot preview</span>
                  </div>
                </div>
              )}
              {(selected.type === "html" || selected.type === "report") && (
                <div className="p-4 font-mono text-[11px] text-muted-foreground">
                  HTML/report preview not available in this pane. Open in browser.
                </div>
              )}
            </>
          )}
          {activeTab === "raw" && (
            <pre className="font-mono text-[10px] leading-relaxed text-foreground/70 overflow-auto scrollbar-thin p-3 h-full">
              Raw content for {selected.name}
            </pre>
          )}
          {activeTab === "metadata" && (
            <div className="p-4 space-y-3">
              <MetaRow label="Name" value={selected.name} />
              <MetaRow label="Type" value={selected.type.toUpperCase()} />
              <MetaRow label="Size" value={selected.size} />
              <MetaRow label="Created" value={selected.age} />
              <MetaRow label="Session" value={selected.session} />
              {selected.thread && <MetaRow label="Thread" value={selected.thread} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px] text-foreground/80">{value}</span>
    </div>
  );
}
