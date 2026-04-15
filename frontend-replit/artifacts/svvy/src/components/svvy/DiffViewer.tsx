import { cn } from "@/lib/utils";

interface DiffLine {
  type: "header" | "hunk" | "add" | "remove" | "context";
  content: string;
  lineNum?: { old?: number; new?: number };
}

const fakeDiff: DiffLine[] = [
  { type: "header", content: "diff --git a/src/middleware/auth.ts b/src/middleware/auth.ts" },
  { type: "header", content: "index a3b4c5d..e6f7g8h 100644" },
  { type: "header", content: "--- a/src/middleware/auth.ts" },
  { type: "header", content: "+++ b/src/middleware/auth.ts" },
  { type: "hunk", content: "@@ -1,15 +1,28 @@" },
  { type: "context", content: " import { Request, Response, NextFunction } from 'express';" },
  { type: "remove", content: "-import { verifyToken } from '../utils/jwt';" },
  { type: "add", content: "+import { verifyToken, extractOAuthToken } from '../utils/jwt';" },
  { type: "add", content: "+import { OAuthProvider } from '../types/oauth';" },
  { type: "context", content: " " },
  { type: "context", content: " export const authMiddleware = async (" },
  { type: "context", content: "   req: Request," },
  { type: "context", content: "   res: Response," },
  { type: "context", content: "   next: NextFunction" },
  { type: "context", content: " ) => {" },
  { type: "remove", content: "-  const token = req.headers.authorization?.split(' ')[1];" },
  { type: "add", content: "+  const authHeader = req.headers.authorization;" },
  { type: "add", content: "+  const provider = req.headers['x-oauth-provider'] as OAuthProvider;" },
  { type: "add", content: "+" },
  { type: "add", content: "+  if (!authHeader) {" },
  { type: "add", content: "+    return res.status(401).json({ error: 'No authorization header' });" },
  { type: "add", content: "+  }" },
  { type: "add", content: "+" },
  { type: "add", content: "+  const token = authHeader.startsWith('Bearer ')" },
  { type: "add", content: "+    ? authHeader.slice(7)" },
  { type: "add", content: "+    : extractOAuthToken(authHeader, provider);" },
  { type: "add", content: "+" },
  { type: "context", content: "   if (!token) {" },
  { type: "context", content: "     return res.status(401).json({ error: 'Unauthorized' });" },
  { type: "context", content: "   }" },
  { type: "hunk", content: "@@ -20,8 +33,12 @@" },
  { type: "context", content: "   try {" },
  { type: "remove", content: "-    const payload = await verifyToken(token);" },
  { type: "add", content: "+    const payload = await verifyToken(token, provider);" },
  { type: "context", content: "     req.user = payload;" },
  { type: "context", content: "     next();" },
  { type: "context", content: "   } catch (err) {" },
  { type: "remove", content: "-    res.status(401).json({ error: 'Invalid token' });" },
  { type: "add", content: "+    res.status(401).json({" },
  { type: "add", content: "+      error: 'Invalid or expired token'," },
  { type: "add", content: "+      provider," },
  { type: "add", content: "+    });" },
  { type: "context", content: "   }" },
  { type: "context", content: " };" },
];

interface DiffViewerProps {
  lines?: DiffLine[];
  filename?: string;
  className?: string;
}

export function DiffViewer({ lines = fakeDiff, filename = "src/middleware/auth.ts", className }: DiffViewerProps) {
  const stats = {
    added: lines.filter(l => l.type === "add").length,
    removed: lines.filter(l => l.type === "remove").length,
  };

  return (
    <div className={cn("flex flex-col h-full", className)} data-testid="diff-viewer">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-muted/20 flex-shrink-0">
        <span className="font-mono text-[11px] text-foreground/80">{filename}</span>
        <span className="font-mono text-[10px] text-emerald-400">+{stats.added}</span>
        <span className="font-mono text-[10px] text-red-400">-{stats.removed}</span>
      </div>
      <div className="flex-1 overflow-auto scrollbar-thin">
        <table className="w-full border-collapse font-mono text-[11px] leading-[1.6]">
          <tbody>
            {lines.map((line, i) => (
              <tr
                key={i}
                className={cn(
                  "group",
                  line.type === "add" && "diff-add",
                  line.type === "remove" && "diff-remove",
                  line.type === "hunk" && "diff-header bg-blue-500/8",
                  line.type === "header" && "diff-header bg-muted/20",
                  line.type === "context" && "diff-context",
                )}
              >
                <td className={cn(
                  "pl-4 pr-2 select-none w-4 text-[10px] text-right opacity-40 border-r border-border/40",
                  line.type === "add" ? "text-emerald-500" : "",
                  line.type === "remove" ? "text-red-500" : "",
                )}>
                  {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                </td>
                <td className="pl-3 pr-4 py-0 whitespace-pre overflow-hidden">
                  {line.content.replace(/^[+-]/, " ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
