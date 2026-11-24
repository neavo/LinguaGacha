import { type JSX, type ReactNode } from "react";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import { useProjectLoad } from "@frontend/features/project-lifecycle/use-project-load";
import { useProjectCreateFlow } from "@frontend/features/project-lifecycle/use-project-create-flow";
import { useProjectOpenFlow } from "@frontend/features/project-lifecycle/use-project-open-flow";
import { useProjectCloseFlow } from "@frontend/features/project-lifecycle/use-project-close-flow";
import { ProjectCreateDialog } from "@frontend/features/project-lifecycle/project-create-dialog";
import { ProjectOpenConfirmations } from "@frontend/features/project-lifecycle/project-open-confirmations";
import { ProjectLifecycleContext } from "./project-lifecycle-context";
import type { BeforePageLeave } from "@frontend/app/navigation/page-leave-context";
import type { ProjectStore } from "@frontend/app/state/project-store-registry";

/** 工程切换会卸载入口页面，生命周期流程与全部确认由常驻会话拥有。 */
export function ProjectLifecycleProvider(props: {
  children: ReactNode;
  attention: number;
  notify_project_required: () => void;
  before_open: BeforePageLeave;
  on_open: (project: ProjectStore) => void;
}): JSX.Element {
  const run_project_load = useProjectLoad(props.before_open, props.on_open);
  const create = useProjectCreateFlow(run_project_load);
  const open = useProjectOpenFlow(run_project_load);
  const close = useProjectCloseFlow(open.handle_recent_project_remove);
  const busy = create.source_selection_disabled || open.is_opening_project || close.closing;
  return (
    <ProjectLifecycleContext.Provider
      value={{
        busy,
        attention: props.attention,
        notify_project_required: props.notify_project_required,
        show_create_dialog: () => {
          if (!busy) create.show();
        },
        create_from_paths: (paths) => {
          if (!busy) create.start_from_paths(paths);
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
        request_close: (id, remove_path) => {
          if (!busy) close.request_close(id, remove_path);
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
