import { useContext, useMemo } from "react";
import { ProjectScopeContext } from "@frontend/app/navigation/project-scope-context";
import { useRuntimeSnapshot } from "./use-desktop-state";

export function useProjectRuntimeSnapshot() {
  const runtime = useRuntimeSnapshot();
  const projectId = useContext(ProjectScopeContext)?.projectId;
  const project = projectId === undefined ? undefined : runtime.projects?.[projectId];
  return useMemo(
    () =>
      projectId === undefined
        ? runtime
        : {
            ...runtime,
            owner: project?.batchTranslation
              ? ("batch_translation" as const)
              : project?.projectWrite
                ? ("project_write" as const)
                : null,
          },
    [runtime, project, projectId],
  );
}
