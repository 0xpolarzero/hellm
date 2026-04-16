import { useLocation } from "wouter";
import { Edit2, Copy, Plus, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModelBadge } from "@/components/svvy/ModelBadge";
import { mockRuntimeProfiles } from "@/data/mock";
import { useTheme } from "@/hooks/useTheme";
import { Sun, Moon } from "lucide-react";

const navItems = [
  "General",
  "Providers",
  "Runtime Profiles",
  "Workspace",
  "Appearance",
  "Keyboard Shortcuts",
  "About",
];

function SettingsLayout({
  children,
  activeItem,
}: {
  children: React.ReactNode;
  activeItem: string;
}) {
  const [, setLocation] = useLocation();
  const { theme, toggle } = useTheme();

  const navPaths: Record<string, string> = {
    Providers: "/settings/auth",
    "Runtime Profiles": "/settings/profiles",
  };

  return (
    <div className="flex h-full bg-background overflow-hidden" data-testid="settings-profiles-page">
      <div className="w-48 flex-shrink-0 border-r border-border flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <button
            onClick={() => setLocation("/session")}
            className="font-mono text-[11px] text-orange-500 font-semibold"
            data-testid="btn-back-to-session"
          >
            ← svvy
          </button>
          <button
            onClick={toggle}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>
        <nav className="flex-1 py-2">
          {navItems.map((item) => (
            <button
              key={item}
              onClick={() => setLocation(navPaths[item] || "/settings/auth")}
              className={cn(
                "w-full text-left px-4 py-2 text-[12px] transition-colors",
                item === activeItem
                  ? "text-foreground bg-secondary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
            >
              {item}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">{children}</div>
    </div>
  );
}

const reasoningBadge = {
  extended: "text-orange-400 border-orange-500/20 bg-orange-500/8",
  standard: "text-blue-400 border-blue-500/20 bg-blue-500/8",
  brief: "text-slate-400 border-slate-500/20 bg-slate-500/8",
  none: "text-muted-foreground border-border bg-transparent",
};

export default function SettingsProfiles() {
  return (
    <SettingsLayout activeItem="Runtime Profiles">
      <div className="max-w-2xl px-8 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-[16px] font-semibold text-foreground">Runtime Profiles</h1>
          <button
            className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded border border-border text-foreground/80 hover:bg-secondary transition-colors"
            data-testid="btn-new-profile"
          >
            <Plus className="w-3 h-3" />
            New profile
          </button>
        </div>

        <div className="border border-amber-500/15 bg-amber-500/5 rounded px-3 py-2.5 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-amber-300/80 leading-relaxed">
            Profiles can be overridden per-repository using a{" "}
            <span className="font-mono">svvy.config.json</span> file in the repo root.
          </p>
        </div>

        <div className="space-y-2">
          {mockRuntimeProfiles.map((profile) => {
            const reasoningKey = profile.reasoning as keyof typeof reasoningBadge;
            return (
              <div
                key={profile.role}
                className="border border-border rounded bg-card px-4 py-3 hover:border-border/70 transition-colors"
                data-testid={`profile-card-${profile.role.toLowerCase()}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[13px] font-medium text-foreground">
                        {profile.role}
                      </span>
                      <ModelBadge model={profile.model} />
                      <span
                        className={cn(
                          "font-mono text-[9px] border rounded px-1.5 py-0.5",
                          reasoningBadge[reasoningKey] || reasoningBadge.none,
                        )}
                      >
                        {profile.reasoning === "none"
                          ? "no reasoning"
                          : `${profile.reasoning} reasoning`}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                      <ProfileMetaRow label="Model" value={profile.model} />
                      <ProfileMetaRow label="Provider" value={profile.provider} />
                      <ProfileMetaRow
                        label="Max tokens"
                        value={profile.maxTokens.toLocaleString()}
                      />
                      <ProfileMetaRow label="Temperature" value={String(profile.temperature)} />
                      <ProfileMetaRow label="Budget/step" value={profile.budgetPerStep} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
                      data-testid={`btn-edit-profile-${profile.role}`}
                    >
                      <Edit2 className="w-2.5 h-2.5" />
                      Edit
                    </button>
                    <button
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
                      data-testid={`btn-duplicate-profile-${profile.role}`}
                    >
                      <Copy className="w-2.5 h-2.5" />
                      Dup
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SettingsLayout>
  );
}

function ProfileMetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[10px] text-foreground/70">{value}</span>
    </div>
  );
}
