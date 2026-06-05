import { AppShell } from "./shell/AppShell";
import { ChatShell } from "./chat/ChatShell";
import { useStudioStore } from "./useStudioStore";

/**
 * Top-level shell switch. The chat-first shell (src/chat) is the default; the
 * original tabbed shell stays one toggle away (/studio or the project-bar gear)
 * so no previous view is ever removed.
 */
export default function App() {
  const shellMode = useStudioStore((s) => s.shellMode);
  return shellMode === "studio" ? <AppShell /> : <ChatShell />;
}
