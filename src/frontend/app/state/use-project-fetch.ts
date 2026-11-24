import { useContext, useMemo } from "react";
import { createProjectFetch } from "@frontend/app/desktop/scoped-api";
import { ProjectScopeContext } from "@frontend/app/navigation/project-scope-context";

export function useProjectFetch() {
  const projectId = useContext(ProjectScopeContext)?.projectId;
  return useMemo(() => createProjectFetch(projectId), [projectId]);
}
