import { useRef, useState, type JSX, type ReactNode } from "react";
import type { ProjectLanguageSettings } from "@domain/project-settings";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
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
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import type { ProjectRenameTarget } from "@frontend/app/state/desktop-state-context";
import { is_project_busy } from "@frontend/app/state/runtime-activity-store";
import { PROJECT_FILE_EXTENSION } from "@shared/project/project-file";
import { is_portable_file_name } from "@shared/utils/file-name";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@frontend/shadcn/input-group";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { ProjectLifecycleContext } from "./project-lifecycle-context";
import { usePageLeave, type BeforePageLeave } from "@frontend/app/navigation/page-leave-context";

/** 工程切换会卸载入口页面，生命周期流程与全部确认由常驻会话拥有。 */
export function ProjectLifecycleProvider(props: {
  children: ReactNode;
  before_open: BeforePageLeave;
  show_project: ShowProject;
}): JSX.Element {
  const run_project_load = useProjectLoad(props.before_open, props.show_project);
  const { t } = useI18n();
  const { open_projects, rename_project } = useDesktopState();
  const { prepare_page_leave } = usePageLeave();
  const runtime = useRuntimeSnapshot();
  const [languages, set_languages] = useState<ProjectLanguageSettings | null>(null);
  const [rename_target, set_rename_target] = useState<{
    target: ProjectRenameTarget;
    name: string;
  } | null>(null);
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

  const target = rename_target?.target;
  const projectId = target !== undefined && "projectId" in target ? target.projectId : undefined;
  const rename_target_busy =
    projectId !== undefined && is_project_busy(runtime.projects?.[projectId]);
  // 列表补读可能发现旧周期已结束，此时确认框随目标失效。
  const rename_target_available =
    projectId === undefined ||
    open_projects.some((project) => project.snapshot.projectId === projectId);

  /** 保存的作用域跟随被改名的工程，后台改名也走同一入口。 */
  async function confirm_rename(target: ProjectRenameTarget, new_name: string): Promise<void> {
    await run_operation(async () => {
      try {
        if (
          "projectId" in target &&
          !(await prepare_page_leave({ kind: "project", projectId: target.projectId }))
        )
          return;
        await rename_project(target, new_name);
        set_rename_target(null);
      } catch (error) {
        push_error_toast(t("app.feedback.rename_failed"), error);
      }
    });
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
          void run_operation(() => open.handle_recent_project_remove(path));
        },
        request_close: (id, remove_path) => {
          if (!running.current) close.request_close(id, remove_path);
        },
        request_rename: (target, name) => {
          if (!running.current) set_rename_target({ target, name });
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
      {rename_target !== null && rename_target_available && (
        <ProjectRenameDialog
          key={
            "projectId" in rename_target.target
              ? rename_target.target.projectId
              : rename_target.target.path
          }
          name={rename_target.name}
          submitting={busy}
          confirm_disabled={rename_target_busy}
          on_close={() => set_rename_target(null)}
          on_submit={(new_name) => confirm_rename(rename_target.target, new_name)}
        />
      )}
    </ProjectLifecycleContext.Provider>
  );
}

/** 工程改名只编辑主干，扩展名固定由工程格式决定。 */
function ProjectRenameDialog(props: {
  name: string;
  submitting: boolean;
  confirm_disabled: boolean;
  on_close: () => void;
  on_submit: (name: string) => Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  const title = t("project.rename");
  const input_ref = useRef<HTMLInputElement>(null);
  const original_name = props.name.toLowerCase().endsWith(PROJECT_FILE_EXTENSION)
    ? props.name.slice(0, -PROJECT_FILE_EXTENSION.length)
    : props.name;
  const [name, set_name] = useState(original_name);

  /** 原样确认直接关闭，允许保留旧工程已有的名称。 */
  function submit(): void | Promise<void> {
    const trimmed = name.trim();
    if (name === original_name || trimmed === original_name) return props.on_close();
    if (!is_portable_file_name(trimmed)) {
      push_toast("warning", t("app.feedback.invalid_file_name"));
      return;
    }
    return props.on_submit(trimmed);
  }

  return (
    <AppPageDialog
      open
      title={title}
      initialFocus={input_ref}
      size="sm"
      submitting={props.submitting}
      onClose={props.on_close}
      primaryAction={{
        label: t("app.action.confirm"),
        shortcut: "submit",
        onSelect: submit,
        disabled: props.confirm_disabled,
      }}
    >
      <InputGroup>
        <InputGroupInput
          aria-label={title}
          ref={input_ref}
          value={name}
          disabled={props.submitting}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => set_name(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>{PROJECT_FILE_EXTENSION}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </AppPageDialog>
  );
}
