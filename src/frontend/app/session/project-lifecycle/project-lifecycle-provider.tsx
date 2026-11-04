import { type JSX, type ReactNode } from "react";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import { useProjectLoad } from "@frontend/features/project-lifecycle/use-project-load";
import { useProjectCreateFlow } from "@frontend/features/project-lifecycle/use-project-create-flow";
import { useProjectOpenFlow } from "@frontend/features/project-lifecycle/use-project-open-flow";
import { useProjectCloseFlow } from "@frontend/features/project-lifecycle/use-project-close-flow";
import { ProjectCreateDialog } from "@frontend/features/project-lifecycle/project-create-dialog";
import { ProjectOpenConfirmations } from "@frontend/features/project-lifecycle/project-open-confirmations";
import { ProjectLifecycleContext } from "./project-lifecycle-context";

/** 工程切换会卸载入口页面，生命周期流程与全部确认由常驻会话拥有。 */
export function ProjectLifecycleProvider(props: { children: ReactNode }): JSX.Element {
  const run_project_load = useProjectLoad();
  const create = useProjectCreateFlow(run_project_load);
  const open = useProjectOpenFlow(run_project_load);
  const close = useProjectCloseFlow();
  const busy = create.is_creating_project || open.is_opening_project || close.closing;
  return (
    <ProjectLifecycleContext.Provider
      value={{
        busy,
        show_create_dialog: () => {
          if (!busy) create.show();
        },
        request_open: (path) => {
          if (!busy) void open.open_project(path);
        },
        open_recent_project: (path) => {
          if (!busy) void open.open_project(path, true);
        },
        remove_recent_project: (path) => {
          if (!busy) void open.handle_recent_project_remove(path);
        },
        can_close: close.can_close && !busy,
        request_close: () => {
          if (!busy) close.request_close();
        },
      }}
    >
      {props.children}
      <ProjectCreateDialog flow={create} />
      <ProjectOpenConfirmations flow={open} />
      <AppConfirmDialog {...close.dialog_props} />
    </ProjectLifecycleContext.Provider>
  );
}
