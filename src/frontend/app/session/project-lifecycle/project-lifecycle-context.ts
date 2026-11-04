import { createContext, useContext } from "react";

export type ProjectLifecycle = Readonly<{
  busy: boolean;
  show_create_dialog: () => void;
  request_open: (path?: string) => void;
  open_recent_project: (path: string) => void;
  remove_recent_project: (path: string) => void;
  can_close: boolean;
  request_close: () => void;
}>;

export const ProjectLifecycleContext = createContext<ProjectLifecycle | null>(null);

/** 工程入口与工作台共用常驻流程。 */
export function useProjectLifecycle(): ProjectLifecycle {
  const lifecycle = useContext(ProjectLifecycleContext);
  if (lifecycle === null)
    throw new Error("useProjectLifecycle must be used inside ProjectLifecycleProvider");
  return lifecycle;
}
