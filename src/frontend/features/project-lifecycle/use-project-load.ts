import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { extract_file_name } from "@frontend/app/desktop/path";
import { run_modal_progress_toast } from "@frontend/app/feedback/desktop-toast";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";

export type RunProjectLoad = (args: {
  message: string;
  request: () => Promise<string>;
}) => Promise<void>;

/** 创建与打开共享收尾，遮罩持续到新工程快照完成首帧渲染。 */
export function useProjectLoad(): RunProjectLoad {
  const {
    set_project_session_status,
    refresh_project_snapshot,
    refresh_settings,
    refresh_batch_translation,
  } = useDesktopState();
  return async ({ message, request }) => {
    await run_modal_progress_toast({
      message,
      task: async () => {
        const path = await request();
        set_project_session_status("warming");
        await refresh_project_snapshot();
        await api_fetch("/api/settings/recent-projects/add", {
          path,
          name: extract_file_name(path).replace(/\.[^.]+$/u, ""),
        });
        await Promise.all([refresh_settings(), refresh_batch_translation()]);
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      },
    });
  };
}
