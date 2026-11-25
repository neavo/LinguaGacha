import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { push_error_toast, run_modal_progress_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";
import type { SettingsSnapshotPayload } from "@frontend/app/state/desktop-state-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import type { BeforePageLeave } from "@frontend/app/navigation/page-leave-context";
import type { AgentInputRequest } from "@frontend/app/navigation/types";

export type ProjectLoadPayload = {
  project: Readonly<{ projectId: string; path: string }>;
};
export type ShowProject = (projectId: string, agent_input_request?: AgentInputRequest) => void;
export type RunProjectLoad = (args: {
  message: string;
  request: () => Promise<ProjectLoadPayload>;
  agent_input_request?: AgentInputRequest;
}) => Promise<boolean>; // 仅完成前台工程交接时返回 true。

/** 创建和打开共用前台交接。后端请求错误交回调用方，以便处理版本确认等操作。 */
export function useProjectLoad(
  before_open: BeforePageLeave,
  show_project: ShowProject,
): RunProjectLoad {
  const { refresh_projects, apply_settings_snapshot } = useDesktopState();
  const { t } = useI18n();
  return async ({ message, request, agent_input_request }) => {
    if (!(await before_open())) return false;
    return await run_modal_progress_toast({
      message,
      task: async () => {
        const {
          project: { projectId, path },
        } = await request();
        try {
          const projects = await refresh_projects();
          if (!projects.some(({ snapshot }) => snapshot.projectId === projectId)) {
            throw new Error(
              `Opened project ${projectId} (${path}) is missing from the project list.`,
            );
          }
          show_project(projectId, agent_input_request);
        } catch (error) {
          push_error_toast(t("app.feedback.load_failed"), error);
          return false;
        }

        // 最近记录维护失败时，用户仍可继续使用已交接的工程。
        try {
          apply_settings_snapshot(
            await api_fetch<SettingsSnapshotPayload>("/api/settings/recent-projects/add", { path }),
          );
        } catch (error) {
          push_error_toast(t("app.feedback.update_failed"), error);
        }
        return true;
      },
    });
  };
}
