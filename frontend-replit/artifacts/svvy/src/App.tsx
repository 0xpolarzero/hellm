import { Switch, Route, Router as WouterRouter } from "wouter";
import { ThemeProvider } from "./hooks/useTheme";
import WorkspaceLauncher from "./pages/WorkspaceLauncher";
import NewSession from "./pages/NewSession";
import MainSession from "./pages/MainSession";
import WorkflowInspectorPage from "./pages/WorkflowInspectorPage";
import ArtifactBrowserPage from "./pages/ArtifactBrowserPage";
import SettingsAuth from "./pages/SettingsAuth";
import SettingsProfiles from "./pages/SettingsProfiles";
import MultiPanePage from "./pages/MultiPanePage";
import SubagentPane from "./pages/SubagentPane";
import NarrowShell from "./pages/NarrowShell";

function Router() {
  return (
    <Switch>
      <Route path="/" component={WorkspaceLauncher} />
      <Route path="/new" component={NewSession} />
      <Route path="/session/multipane" component={MultiPanePage} />
      <Route path="/session/subagent" component={SubagentPane} />
      <Route path="/session/inspector">
        {() => <MainSession variant="inspector" />}
      </Route>
      <Route path="/session/active">
        {() => <MainSession variant="active" />}
      </Route>
      <Route path="/session/waiting">
        {() => <MainSession variant="waiting" />}
      </Route>
      <Route path="/session/failed">
        {() => <MainSession variant="failed" />}
      </Route>
      <Route path="/session">
        {() => <MainSession variant="default" />}
      </Route>
      <Route path="/workflow" component={WorkflowInspectorPage} />
      <Route path="/artifacts" component={ArtifactBrowserPage} />
      <Route path="/settings/auth" component={SettingsAuth} />
      <Route path="/settings/profiles" component={SettingsProfiles} />
      <Route path="/narrow" component={NarrowShell} />
      <Route>
        {() => (
          <div className="h-full flex items-center justify-center bg-background">
            <div className="text-center">
              <p className="font-mono text-[12px] text-muted-foreground mb-2">404 — route not found</p>
              <a href="/" className="text-[12px] text-orange-500 hover:text-orange-400 underline underline-offset-2">
                Go to launcher
              </a>
            </div>
          </div>
        )}
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
      </WouterRouter>
    </ThemeProvider>
  );
}
