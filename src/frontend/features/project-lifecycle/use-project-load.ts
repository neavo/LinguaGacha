import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { extract_file_name } from "@frontend/app/desktop/path";
import { run_modal_progress_toast } from "@frontend/app/feedback/desktop-toast";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import type { ProjectStore } from "@frontend/app/state/project-store-registry";
import type { BeforePageLeave } from "@frontend/app/navigation/page-leave-context";

export type RunProjectLoad = (args: {
  message: string;
  request: () => Promise<string>;
}) => Promise<void>;

/** 创建与打开共享收尾，遮罩持续到新工程快照完成首帧渲染。 */
export function useProjectLoad(
  before_open: BeforePageLeave,
  select: (project: ProjectStore) => void,
): RunProjectLoad {
  const { refresh_projects, refresh_settings } = useDesktopState();
  return async ({ message, request }) => {
    if (!(await before_open())) return;
    await run_modal_progress_toast({
      message,
      task: async () => {
        const path = await request();
        const projects = await refresh_projects();
        const project = projects.find((candidate) => candidate.snapshot.path === path);
        if (project) select(project);
        await api_fetch("/api/settings/recent-projects/add", {
          path,
          name: extract_file_name(path).replace(/\.[^.]+$/u, ""),
        });
        await refresh_settings();
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      },
    });
  };
}
