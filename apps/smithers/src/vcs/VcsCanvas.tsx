import { STATUS_GLYPH, STATUS_LABEL, summarize, type Change } from "./vcs";
import { useVcsStore, type VcsActionId } from "./vcsStore";

const ACTIONS: { id: VcsActionId; label: string; brand?: boolean }[] = [
  { id: "status", label: "Status" },
  { id: "stage-all", label: "Stage all" },
  { id: "commit", label: "Commit", brand: true },
  { id: "rebase-plan", label: "Plan rebase" },
  { id: "push", label: "Push" },
];

function ChangeRow({ change, onToggle }: { change: Change; onToggle: (path: string) => void }) {
  return (
    <button type="button" className="vcs-row" onClick={() => onToggle(change.path)} data-testid="vcs-change">
      <span className={`vcs-glyph is-${change.status}`}>{STATUS_GLYPH[change.status]}</span>
      <span className="vcs-path">{change.path}</span>
      <span className="vcs-delta">
        {change.add > 0 ? <span className="delta-add">+{change.add}</span> : null}
        {change.del > 0 ? <span className="delta-del">−{change.del}</span> : null}
      </span>
      <span className="vcs-label">{STATUS_LABEL[change.status]}</span>
    </button>
  );
}

/** The full VCS dashboard: working-tree status, a change list, and bookmarks. */
export function VcsCanvas() {
  const backend = useVcsStore((state) => state.backend);
  const tree = useVcsStore((state) => state.tree);
  const pending = useVcsStore((state) => state.pending);
  const setBackend = useVcsStore((state) => state.setBackend);
  const toggleStage = useVcsStore((state) => state.toggleStage);
  const runAction = useVcsStore((state) => state.runAction);

  const summary = summarize(tree);
  const staged = tree.changes.filter((change) => change.staged && change.status !== "untracked");
  const unstaged = tree.changes.filter((change) => !(change.staged && change.status !== "untracked"));

  return (
    <section className="surface" data-testid="vcs-canvas">
      <header className="surface-head">
        <span className="surface-title">Changes</span>
        <span className="surface-sub">
          <code className="vcs-mono">{tree.branch}</code> @ <code className="vcs-mono">{tree.head}</code> ·{" "}
          {summary.total} file{summary.total === 1 ? "" : "s"} · <span className="delta-add">+{summary.add}</span>{" "}
          <span className="delta-del">−{summary.del}</span>
        </span>
        <div className="seg vcs-backend" data-testid="vcs-backend">
          <button
            type="button"
            className={backend === "git" ? "is-on" : ""}
            onClick={() => setBackend("git")}
          >
            git
          </button>
          <button
            type="button"
            className={backend === "jj" ? "is-on" : ""}
            onClick={() => setBackend("jj")}
          >
            jj
          </button>
        </div>
      </header>

      <div className="vcs-actions" data-testid="vcs-actions">
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            className={action.brand ? "btn btn-brand" : "btn"}
            onClick={() => runAction(action.id)}
            disabled={pending !== null}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div className="vcs-body">
        <div className="vcs-changes">
          <div className="vcs-section-head">
            Staged <span className="vcs-count">{staged.length}</span>
          </div>
          {staged.length > 0 ? (
            staged.map((change) => (
              <ChangeRow key={change.path} change={change} onToggle={toggleStage} />
            ))
          ) : (
            <div className="vcs-empty">Nothing staged.</div>
          )}

          <div className="vcs-section-head">
            Unstaged <span className="vcs-count">{unstaged.length}</span>
          </div>
          {unstaged.length > 0 ? (
            unstaged.map((change) => (
              <ChangeRow key={change.path} change={change} onToggle={toggleStage} />
            ))
          ) : (
            <div className="vcs-empty">Working tree clean.</div>
          )}
        </div>

        <aside className="vcs-bookmarks" data-testid="vcs-bookmarks">
          <div className="vcs-section-head">{backend === "jj" ? "Bookmarks" : "Branches"}</div>
          {tree.bookmarks.map((bookmark) => (
            <div
              className={bookmark.current ? "vcs-bookmark is-current" : "vcs-bookmark"}
              key={bookmark.name}
            >
              <span className={bookmark.current ? "ready-dot is-on" : "ready-dot"} />
              <div className="vcs-bookmark-text">
                <div className="vcs-bookmark-name">{bookmark.name}</div>
                <div className="vcs-bookmark-meta">
                  <code className="vcs-mono">{bookmark.ref}</code>
                  {bookmark.ahead > 0 ? <span className="mini-tag">↑{bookmark.ahead}</span> : null}
                  {bookmark.behind > 0 ? <span className="mini-tag">↓{bookmark.behind}</span> : null}
                </div>
              </div>
            </div>
          ))}
        </aside>
      </div>
    </section>
  );
}
