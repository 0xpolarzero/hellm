import type { CSSProperties, ReactElement } from "react";
import { openSurface } from "../app/navigation";
import { RemoteModePanel } from "../auth/RemoteModePanel";
import { GatewayWorkflowsSection } from "../gateway/GatewayWorkflowsSection";
import { EXAMPLE_WORKFLOWS } from "./exampleWorkflows";
import { openWorkflow } from "./openWorkflow";
import { WORKFLOW_DOCS } from "./workflowDocs";
import { useWorkflowsStore } from "./workflowsStore";
import { STORE_WORKFLOWS, type StoreWorkflow } from "./workflows";

// Installed defaults first, then every example available to install.
const ALL_WORKFLOWS = [...STORE_WORKFLOWS, ...EXAMPLE_WORKFLOWS];

// The default pack ships pre-installed — these ids are always "installed".
const DEFAULT_INSTALLED = STORE_WORKFLOWS.map((workflow) => workflow.id);

// The ids the workflow editor seeds a document for — only these can be edited.
const EDITABLE_IDS = new Set(WORKFLOW_DOCS.map((doc) => doc.id));

/** The "app store" of workflows — a browsable grid of cards you can open. */
export function WorkflowStore() {
  const extras = useWorkflowsStore((state) => state.installed);
  const install = useWorkflowsStore((state) => state.install);
  const isInstalled = (id: string): boolean =>
    DEFAULT_INSTALLED.includes(id) || extras.includes(id);
  const installed = ALL_WORKFLOWS.filter((workflow) => isInstalled(workflow.id));
  const available = ALL_WORKFLOWS.filter((workflow) => !isInstalled(workflow.id));

  return (
    <div className="store">
      <div className="store-inner">
        <header className="store-header">
          <h1 className="store-title">Workflow Store</h1>
          <p className="store-subtitle">
            Open an installed workflow to drop into a guided task, or install
            another from the examples below.
          </p>
        </header>

        <RemoteModePanel />

        <StoreSection
          count={`${installed.length} ready to run`}
          title="Installed"
          workflows={installed}
          renderCard={(workflow) => (
            <button
              className="store-card"
              key={workflow.id}
              style={{ "--card-color": workflow.color } as CSSProperties}
              type="button"
              onClick={() => openWorkflow(workflow)}
            >
              <StoreCardBody workflow={workflow} />
              <span
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}
              >
                <span className="store-open">Open →</span>
                {EDITABLE_IDS.has(workflow.id) ? (
                  // Edit jumps straight to the workflow editor surface. It lives
                  // inside the card button, so stop the click from also firing
                  // the card's Open handler.
                  <span
                    className="store-open"
                    role="button"
                    tabIndex={0}
                    style={{ opacity: 0.85 }}
                    onClick={(event) => {
                      event.stopPropagation();
                      openSurface({ kind: "workflowEditor", id: workflow.id });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        openSurface({ kind: "workflowEditor", id: workflow.id });
                      }
                    }}
                  >
                    Edit ›
                  </span>
                ) : null}
              </span>
            </button>
          )}
        />

        {available.length > 0 ? (
          <StoreSection
            count={`${available.length} from examples`}
            title="Available"
            workflows={available}
            renderCard={(workflow) => (
              <div
                className="store-card store-card--available"
                key={workflow.id}
                style={{ "--card-color": workflow.color } as CSSProperties}
              >
                <StoreCardBody workflow={workflow} />
                <button
                  className="store-install"
                  type="button"
                  onClick={() => install(workflow.id)}
                >
                  <span aria-hidden="true">＋</span> Install
                </button>
              </div>
            )}
          />
        ) : null}

        <GatewayWorkflowsSection />
      </div>
    </div>
  );
}

/** A titled grid of workflow cards. */
function StoreSection({
  title,
  count,
  workflows,
  renderCard,
}: {
  title: string;
  count: string;
  workflows: StoreWorkflow[];
  renderCard: (workflow: StoreWorkflow) => ReactElement;
}) {
  return (
    <section className="store-section">
      <div className="store-section-head">
        <h2 className="store-section-title">{title}</h2>
        <span className="store-section-count">{count}</span>
      </div>
      <div className="store-grid">{workflows.map(renderCard)}</div>
    </section>
  );
}

/** The icon, title, tag, and description shared by every card. */
function StoreCardBody({ workflow }: { workflow: StoreWorkflow }) {
  return (
    <>
      <span className="store-icon" aria-hidden="true">
        {workflow.icon}
      </span>
      <span className="store-card-head">
        <span className="store-name">{workflow.name}</span>
        <span className="store-tag">{workflow.category}</span>
      </span>
      <span className="store-desc">{workflow.description}</span>
    </>
  );
}
