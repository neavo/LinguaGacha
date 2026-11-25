import { createContext, useContext } from "react";
import type { CreateEmptyProjectOptions } from "@frontend/features/project-lifecycle/use-project-create-flow";
import type { ProjectStore } from "@frontend/app/state/project-store-registry";

export type ProjectLifecycle = Readonly<{
  busy: boolean;
  request_create: () => void;
  create_for_agent: (options: CreateEmptyProjectOptions) => Promise<ProjectStore | null>;
  request_open: (path?: string) => void;
  open_recent_project: (path: string) => void;
  remove_recent_project: (path: string) => void;
  request_close: (projectId: string, remove_path?: string) => void;
}>;

export const ProjectLifecycleContext = createContext<ProjectLifecycle | null>(null);

/** 工程入口与工作台共用常驻流程。 */
export function useProjectLifecycle(): ProjectLifecycle {
  const lifecycle = useContext(ProjectLifecycleContext);
  if (lifecycle === null)
    throw new Error("useProjectLifecycle must be used inside ProjectLifecycleProvider");
  return lifecycle;
}
