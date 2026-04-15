import { useLocation } from "wouter";
import { CheckCircle2, Circle, ExternalLink, Key, User, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { Sun, Moon } from "lucide-react";

const navItems = [
  { label: "General", path: "/settings/auth" },
  { label: "Providers", path: "/settings/auth", active: true },
  { label: "Runtime Profiles", path: "/settings/profiles" },
  { label: "Workspace", path: "/settings/auth" },
  { label: "Appearance", path: "/settings/auth" },
  { label: "Keyboard Shortcuts", path: "/settings/auth" },
  { label: "About", path: "/settings/auth" },
];

const providers = [
  {
    name: "Anthropic",
    status: "connected",
    maskedKey: "sk-ant-••••••••••••••••••••••••••••••••",
    note: "API key from environment",
  },
  {
    name: "OpenAI",
    status: "disconnected",
    note: "Not configured",
  },
  {
    name: "Google Gemini",
    status: "disconnected",
    note: "OAuth not connected",
    authType: "oauth",
  },
  {
    name: "Azure OpenAI",
    status: "disconnected",
    note: "Not configured",
    authType: "config",
  },
  {
    name: "Local (Ollama)",
    status: "connected",
    maskedKey: "http://localhost:11434",
    note: "Local endpoint",
  },
];

const oauthConnections = [
  {
    name: "GitHub",
    status: "connected",
    user: "dev-username",
    avatar: "DU",
  },
  {
    name: "Linear",
    status: "disconnected",
  },
  {
    name: "Jira",
    status: "disconnected",
  },
];

const envCreds = [
  { name: "ANTHROPIC_API_KEY", found: true },
  { name: "OPENAI_API_KEY", found: false },
  { name: "GITHUB_TOKEN", found: true },
];

function SettingsLayout({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { theme, toggle } = useTheme();

  return (
    <div className="flex h-full bg-background overflow-hidden" data-testid="settings-page">
      {/* Settings sidebar */}
      <div className="w-48 flex-shrink-0 border-r border-border flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <button
            onClick={() => setLocation("/session")}
            className="font-mono text-[11px] text-orange-500 font-semibold"
            data-testid="btn-back-to-session"
          >
            ← svvy
          </button>
          <button onClick={toggle} className="text-muted-foreground hover:text-foreground transition-colors">
            {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>
        <nav className="flex-1 py-2">
          {navItems.map(item => (
            <button
              key={item.label}
              onClick={() => setLocation(item.path)}
              className={cn(
                "w-full text-left px-4 py-2 text-[12px] transition-colors",
                item.active
                  ? "text-foreground bg-secondary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
              data-testid={`settings-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {children}
      </div>
    </div>
  );
}

export default function SettingsAuth() {
  return (
    <SettingsLayout>
      <div className="max-w-2xl px-8 py-8 space-y-8">
        <h1 className="text-[16px] font-semibold text-foreground">Providers</h1>

        {/* AI Providers */}
        <section>
          <h2 className="text-[11px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            AI Providers
          </h2>
          <div className="border border-border rounded divide-y divide-border overflow-hidden">
            {providers.map(p => (
              <div key={p.name} className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-card/80 transition-colors">
                <div className="w-2 h-2 rounded-full flex-shrink-0">
                  {p.status === "connected"
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    : <Circle className="w-3.5 h-3.5 text-muted-foreground/40" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-foreground">{p.name}</span>
                    {p.status === "connected" && (
                      <span className="font-mono text-[9px] text-emerald-400 border border-emerald-500/20 bg-emerald-500/8 rounded px-1">connected</span>
                    )}
                  </div>
                  {p.maskedKey ? (
                    <span className="font-mono text-[10px] text-muted-foreground">{p.maskedKey}</span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">{p.note}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {p.status === "connected" ? (
                    <>
                      <button className="text-[11px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors" data-testid={`btn-edit-${p.name}`}>Edit</button>
                      <button className="text-[11px] text-red-400 hover:text-red-300 border border-red-500/20 rounded px-2 py-1 transition-colors" data-testid={`btn-revoke-${p.name}`}>Revoke</button>
                    </>
                  ) : p.authType === "oauth" ? (
                    <button className="text-[11px] text-foreground/80 hover:text-foreground border border-border rounded px-2.5 py-1 transition-colors flex items-center gap-1" data-testid={`btn-connect-${p.name}`}>
                      <ExternalLink className="w-2.5 h-2.5" /> Connect OAuth
                    </button>
                  ) : (
                    <button className="text-[11px] text-foreground/80 hover:text-foreground border border-border rounded px-2.5 py-1 transition-colors flex items-center gap-1" data-testid={`btn-connect-key-${p.name}`}>
                      <Key className="w-2.5 h-2.5" /> Add API key
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* OAuth Connections */}
        <section>
          <h2 className="text-[11px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            OAuth Connections
          </h2>
          <div className="border border-border rounded divide-y divide-border overflow-hidden">
            {oauthConnections.map(c => (
              <div key={c.name} className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-card/80 transition-colors">
                <div className="w-7 h-7 rounded bg-secondary flex items-center justify-center flex-shrink-0">
                  <User className="w-3 h-3 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-foreground">{c.name}</span>
                    {c.status === "connected" && (
                      <span className="font-mono text-[9px] text-emerald-400 border border-emerald-500/20 bg-emerald-500/8 rounded px-1">connected</span>
                    )}
                  </div>
                  {c.user && (
                    <span className="text-[11px] text-muted-foreground">{c.user}</span>
                  )}
                </div>
                <div className="flex-shrink-0">
                  {c.status === "connected" ? (
                    <button className="text-[11px] text-red-400 hover:text-red-300 border border-red-500/20 rounded px-2 py-1 transition-colors" data-testid={`btn-disconnect-${c.name}`}>Disconnect</button>
                  ) : (
                    <button className="text-[11px] text-foreground/80 hover:text-foreground border border-border rounded px-2.5 py-1 transition-colors flex items-center gap-1" data-testid={`btn-connect-oauth-${c.name}`}>
                      <ExternalLink className="w-2.5 h-2.5" /> Connect
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Environment-backed credentials */}
        <section>
          <h2 className="text-[11px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Environment-backed Credentials
          </h2>
          <div className="border border-amber-500/15 bg-amber-500/5 rounded px-3 py-2.5 mb-3 flex items-start gap-2">
            <Shield className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-amber-300/80 leading-relaxed">
              These credentials are loaded from your shell environment and cannot be edited here.
            </p>
          </div>
          <div className="border border-border rounded divide-y divide-border overflow-hidden">
            {envCreds.map(c => (
              <div key={c.name} className="flex items-center justify-between px-4 py-2.5 bg-card">
                <span className="font-mono text-[11px] text-foreground/80">{c.name}</span>
                {c.found ? (
                  <span className="font-mono text-[9px] text-emerald-400 border border-emerald-500/20 bg-emerald-500/8 rounded px-1.5 py-0.5 flex items-center gap-1">
                    <CheckCircle2 className="w-2 h-2" /> found in env
                  </span>
                ) : (
                  <span className="font-mono text-[9px] text-muted-foreground border border-border rounded px-1.5 py-0.5">not found</span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </SettingsLayout>
  );
}
