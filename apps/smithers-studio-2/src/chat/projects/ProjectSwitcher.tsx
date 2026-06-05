import { useProjects } from "./useProjects";

/**
 * Project picker dropdown. Each project shows its accent color dot; choosing one
 * sets the current project (which re-scopes the chat feed and stats).
 */
export function ProjectSwitcher({ onClose }: { onClose: () => void }) {
  const { projects, current, setCurrent } = useProjects();
  return (
    <div className="project-menu" data-testid="project-menu" role="listbox">
      {projects.map((project) => (
        <button
          aria-selected={project.id === current.id}
          className={project.id === current.id ? "project-menu-row project-menu-row--active" : "project-menu-row"}
          data-testid="project-menu-row"
          key={project.id}
          onClick={() => {
            setCurrent(project.id);
            onClose();
          }}
          role="option"
          type="button"
        >
          <span className="project-dot" style={{ background: project.color }} />
          {project.name}
        </button>
      ))}
    </div>
  );
}
