import { AppShell } from "@/components/svvy/AppShell";
import { ArtifactBrowser } from "@/components/svvy/ArtifactBrowser";

export default function ArtifactBrowserPage() {
  return (
    <AppShell
      title="OAuth Provider Integration"
      sessionStatus="running"
      worktree="feat/oauth-provider"
      budgetPercent={71}
    >
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
          <h2 className="text-[12px] font-medium text-foreground">Artifacts</h2>
          <span className="font-mono text-[10px] text-muted-foreground">8 files</span>
        </div>
        <div className="flex-1 min-h-0">
          <ArtifactBrowser />
        </div>
      </div>
    </AppShell>
  );
}
