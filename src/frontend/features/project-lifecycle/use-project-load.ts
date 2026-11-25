import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { push_error_toast, run_modal_progress_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";
import type { SettingsSnapshotPayload } from "@frontend/app/state/desktop-state-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import type { BeforePageLeave } from "@frontend/app/navigation/page-leave-context";
import type { ProjectStore } from "@frontend/app/state/project-store-registry";
import type { AgentInputRequest } from "@frontend/app/navigation/types";

export type ProjectLoadPayload = {
  project: Readonly<{ projectId: string; path: string }>;
};
export type ShowProject = (projectId: string, request?: AgentInputRequest) => void;
export type RunProjectLoad = (args: {
  message: string;
  request: () => Promise<ProjectLoadPayload>;
  minimum_progress_ms?: number;
  agent_input_request?: AgentInputRequest | undefined;
}) => Promise<ProjectStore | null>;

/** 创建和打开共用前台交接。后端请求错误交回调用方，以便处理版本确认等操作。 */
export function useProjectLoad(
  before_open: BeforePageLeave,
  show_project: ShowProject,
): RunProjectLoad {
  const { apply_project_load, apply_settings_snapshot } = useDesktopState();
  const { t } = useI18n();
  return async ({ message, request, minimum_progress_ms, agent_input_request }) => {
    if (!(await before_open())) return null;
    return await run_modal_progress_toast({
      message,
      show_for_entire_task: minimum_progress_ms !== undefined,
      task: async () => {
        const started_at = Date.now();
        const payload = await request();
        // 快请求等够进度时间再交接。失败沿请求的错误出口立即返回。
        if (minimum_progress_ms !== undefined) {
          const remaining_ms = minimum_progress_ms - (Date.now() - started_at);
          if (remaining_ms > 0) await new Promise((resolve) => setTimeout(resolve, remaining_ms));
        }
        const project = apply_project_load(payload);
        if (project === undefined) throw new TypeError("Invalid project load response.");
        const { projectId, path } = project.snapshot;
        show_project(projectId, agent_input_request);

        // 最近记录维护失败时，用户仍可继续使用已交接的工程。
        try {
          apply_settings_snapshot(
            await api_fetch<SettingsSnapshotPayload>("/api/settings/recent-projects/add", { path }),
          );
        } catch (error) {
          push_error_toast(t("app.feedback.update_failed"), error);
        }
        return project;
      },
    });
  };
}
