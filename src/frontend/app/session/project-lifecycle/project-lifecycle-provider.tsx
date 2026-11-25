import { useRef, useState, type JSX, type ReactNode } from "react";
import type { ProjectLanguageSettings } from "@domain/project-settings";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";
import { format_agent_translation_request } from "@frontend/app/navigation/agent-input-steps";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";
import {
  useProjectLoad,
  type ShowProject,
} from "@frontend/features/project-lifecycle/use-project-load";
import { useProjectCreateFlow } from "@frontend/features/project-lifecycle/use-project-create-flow";
import { useProjectOpenFlow } from "@frontend/features/project-lifecycle/use-project-open-flow";
import { useProjectCloseFlow } from "@frontend/features/project-lifecycle/use-project-close-flow";
import { ProjectLanguageDialog } from "@frontend/features/project-language/project-language-dialog";
import { read_project_language_preference } from "@frontend/features/project-lifecycle/project-language-preference";
import { ProjectOpenConfirmations } from "@frontend/features/project-lifecycle/project-open-confirmations";
import { ProjectLifecycleContext } from "./project-lifecycle-context";
import type { BeforePageLeave } from "@frontend/app/navigation/page-leave-context";

/** 工程切换会卸载入口页面，生命周期流程与全部确认由常驻会话拥有。 */
export function ProjectLifecycleProvider(props: {
  children: ReactNode;
  before_open: BeforePageLeave;
  show_project: ShowProject;
}): JSX.Element {
  const run_project_load = useProjectLoad(props.before_open, props.show_project);
  const { t } = useI18n();
  const [languages, set_languages] = useState<ProjectLanguageSettings | null>(null);
  const [busy, set_busy] = useState(false);
  const running = useRef(false);
  const create_empty_project = useProjectCreateFlow(run_project_load);
  const open = useProjectOpenFlow(run_project_load);
  const close = useProjectCloseFlow(open.handle_recent_project_remove);

  // 系统选择框和生命周期写入共用互斥，React 发布禁用态前也能挡住重复操作。
  async function run_operation<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (running.current) return undefined;
    running.current = true;
    set_busy(true);
    try {
      return await operation();
    } finally {
      running.current = false;
      set_busy(false);
    }
  }
  return (
    <ProjectLifecycleContext.Provider
      value={{
        busy,
        request_create: () => {
          if (!running.current) set_languages(read_project_language_preference());
        },
        create_for_agent: async (options) =>
          (await run_operation(() => create_empty_project(options))) ?? null,
        request_open: (path) => {
          void run_operation(() => open.open_project(path));
        },
        open_recent_project: (path) => {
          void run_operation(() => open.open_project(path, true));
        },
        remove_recent_project: (path) => {
          if (!busy) void open.handle_recent_project_remove(path);
        },
        request_close: (id, remove_path) => {
          if (!running.current) close.request_close(id, remove_path);
        },
      }}
    >
      {props.children}
      {languages !== null ? (
        <ProjectLanguageDialog
          title={t("project.create.title")}
          languages={languages}
          disabled={busy}
          on_change={set_languages}
          on_close={() => set_languages(null)}
          on_confirm={async () => {
            set_languages(null);
            const project = await run_operation(() =>
              create_empty_project({
                languages,
                agent_input_request: format_agent_translation_request(t, []),
              }),
            );
            if (project) push_toast("success", t("project.create.success"));
          }}
        />
      ) : null}
      <ProjectOpenConfirmations
        flow={open}
        on_confirm={async () => {
          await run_operation(open.confirm_open);
        }}
      />
      <AppConfirmDialog
        {...close.dialog_props}
        submitting={busy}
        onConfirm={async () => {
          await run_operation(close.dialog_props.onConfirm);
        }}
      />
    </ProjectLifecycleContext.Provider>
  );
}
