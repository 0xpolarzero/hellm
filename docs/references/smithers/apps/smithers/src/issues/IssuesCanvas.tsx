import { useState } from "react";
import { getPlatformBaseUrl } from "../jjhub/platformBaseUrl";
import { filterIssues, summarizeIssues, toneForIssueState, type IssueFilter } from "./issues";
import { useIssuesStore } from "./issuesStore";

const FILTERS: { id: IssueFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

/**
 * Repo selector — visible only when a platform base URL is configured. The user
 * picks `owner/repo` and the store binds the issues card to that context,
 * which triggers `hydrateFromPlatform` and replaces the seeded backlog with
 * live Plue issues. With no base URL the seeded list stays put and this row
 * doesn't render, preserving offline/dev behavior.
 */
function RepoContextBar() {
  const repoContext = useIssuesStore((state) => state.repoContext);
  const hydrationStatus = useIssuesStore((state) => state.hydrationStatus);
  const hydrationSource = useIssuesStore((state) => state.hydrationSource);
  const hydrationError = useIssuesStore((state) => state.hydrationError);
  const selectRepoContext = useIssuesStore((state) => state.selectRepoContext);

  const initial = repoContext ? `${repoContext.owner}/${repoContext.repo}` : "";
  const [draft, setDraft] = useState(initial);

  if (!getPlatformBaseUrl()) return null;

  return (
    <form
      className="rev-repo-context"
      data-testid="issues-repo-context"
      onSubmit={(event) => {
        event.preventDefault();
        const parts = draft.trim().split("/");
        if (parts.length !== 2 || !parts[0] || !parts[1]) return;
        void selectRepoContext(parts[0], parts[1]);
      }}
    >
      <input
        type="text"
        className="field-input"
        placeholder="owner/repo"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        data-testid="issues-repo-context-input"
      />
      <button className="btn" type="submit" data-testid="issues-repo-context-submit">
        {hydrationStatus === "loading" ? "Loading…" : "Sync from Plue"}
      </button>
      {hydrationSource === "platform" ? (
        <span className="rev-sub" data-testid="issues-hydration-source">
          live · {repoContext?.owner}/{repoContext?.repo}
        </span>
      ) : null}
      {hydrationStatus === "error" && hydrationError ? (
        <span className="rev-sub rev-sub-error" data-testid="issues-hydration-error">
          {hydrationError}
        </span>
      ) : null}
    </form>
  );
}

/** The create form, shown at the top of the list when the store is creating. */
function CreateForm() {
  const draftTitle = useIssuesStore((state) => state.draftTitle);
  const draftBody = useIssuesStore((state) => state.draftBody);
  const setDraftTitle = useIssuesStore((state) => state.setDraftTitle);
  const setDraftBody = useIssuesStore((state) => state.setDraftBody);
  const submitCreate = useIssuesStore((state) => state.submitCreate);
  const cancelCreate = useIssuesStore((state) => state.cancelCreate);

  return (
    <div className="rev-create" data-testid="issues-create">
      <div className="rev-create-head">New issue</div>
      <input
        className="field-input"
        placeholder="Title"
        value={draftTitle}
        onChange={(event) => setDraftTitle(event.target.value)}
        data-testid="issues-create-title"
      />
      <textarea
        className="field-input"
        placeholder="Describe the issue"
        value={draftBody}
        onChange={(event) => setDraftBody(event.target.value)}
        data-testid="issues-create-body"
      />
      <div className="rev-detail-actions">
        <button className="btn btn-brand" type="button" onClick={submitCreate}>
          Create
        </button>
        <button className="btn" type="button" onClick={cancelCreate}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The full issues surface: a filtered list on the left, issue detail on the right. */
export function IssuesCanvas() {
  const issues = useIssuesStore((state) => state.issues);
  const filter = useIssuesStore((state) => state.filter);
  const creating = useIssuesStore((state) => state.creating);
  const setFilter = useIssuesStore((state) => state.setFilter);
  const openCreate = useIssuesStore((state) => state.openCreate);
  const select = useIssuesStore((state) => state.select);
  const close = useIssuesStore((state) => state.close);
  const reopen = useIssuesStore((state) => state.reopen);
  const selected = useIssuesStore((state) => state.issues.find((i) => i.id === state.selectedId) ?? null);

  const summary = summarizeIssues(issues);
  const shown = filterIssues(issues, filter);

  return (
    <section className="surface" data-testid="issues-canvas">
      <header className="surface-head">
        <span className="surface-title">Issues</span>
        <span className="surface-sub">
          {summary.open} open · {summary.closed} closed
        </span>
        <RepoContextBar />
        <div className="seg" data-testid="issues-filter">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={filter === option.id ? "is-on" : ""}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button className="btn btn-brand" type="button" onClick={openCreate}>
          New issue
        </button>
      </header>

      <div className="rev-body">
        <div className="rev-list">
          {creating ? <CreateForm /> : null}
          {shown.length > 0 ? (
            shown.map((issue) => (
              <button
                key={issue.id}
                type="button"
                className={selected?.id === issue.id ? "rev-row is-on" : "rev-row"}
                onClick={() => select(issue.id)}
                data-testid="issues-row"
              >
                <span className={`rev-dot ${toneForIssueState(issue.state)}`} />
                <div className="rev-row-main">
                  <div className="rev-row-title">{issue.title}</div>
                  <div className="rev-row-meta">
                    <span className="rev-num">#{issue.number}</span>
                    {issue.labels.map((label) => (
                      <span className="mini-tag" key={label}>
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="rev-empty">No issues here.</div>
          )}
        </div>

        <div className="rev-detail">
          {selected ? (
            <div className="rev-detail-scroll">
              <div className="rev-detail-head">
                <div className="rev-detail-title">{selected.title}</div>
              </div>
              <div className="rev-row-meta">
                <span className="rev-num">#{selected.number}</span>
                <span className={`state-badge ${toneForIssueState(selected.state)}`}>
                  {selected.state === "open" ? "OPEN" : "CLOSED"}
                </span>
                {selected.labels.map((label) => (
                  <span className="mini-tag" key={label}>
                    {label}
                  </span>
                ))}
                {selected.assignees.map((assignee) => (
                  <span className="mini-tag" key={assignee}>
                    @{assignee}
                  </span>
                ))}
              </div>
              <div className="rev-prose">{selected.body}</div>
              <div className="rev-detail-actions">
                {selected.state === "open" ? (
                  <button className="btn" type="button" onClick={() => close(selected.number)}>
                    Close issue
                  </button>
                ) : (
                  <button className="btn btn-brand" type="button" onClick={() => reopen(selected.number)}>
                    Reopen issue
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="rev-detail-empty">Select an issue.</div>
          )}
        </div>
      </div>
    </section>
  );
}
