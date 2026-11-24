import { useContext, useMemo } from "react";
import { createProjectFetch } from "@frontend/app/desktop/scoped-api";
import { ProjectScopeContext } from "@frontend/app/navigation/project-scope-context";

/** 请求函数固定到页面挂载时所属的工程，异步操作沿用发起时的身份。 */
export function useProjectFetch() {
  const projectId = useContext(ProjectScopeContext)?.projectId;
  return useMemo(() => createProjectFetch(projectId), [projectId]);
}
