import { useCallback, useState } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import {
  push_error_toast,
  push_toast,
  run_modal_progress_toast,
} from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";

type GamePaths = Readonly<{ font_path: string | null; game_path: string | null }>; // 未选择时为 null。
type GameFontStatus = "idle" | "checking" | "ready" | "running"; // 只有检查通过的路径组合才能执行。

/** 拥有路径选择、检查、确认与执行状态，游戏文件的写入全部由后端完成。 */
export function useGameFontPageState() {
  const { t } = useI18n();
  const [paths, set_paths] = useState<GamePaths>({ font_path: null, game_path: null });
  const [status, set_status] = useState<GameFontStatus>("idle");
  const [confirm_open, set_confirm_open] = useState(false);

  /** 检查期间选择按钮已禁用，检查结果总是对应当前路径。 */
  const pick = useCallback(
    async (
      picker: Window["desktopApp"]["pickGameFontFilePath"],
      field: keyof GamePaths,
    ): Promise<void> => {
      let selected: string | undefined;
      try {
        const result = await picker();
        selected = result.canceled ? undefined : result.paths[0];
      } catch (error) {
        push_error_toast(t("app.feedback.operation_failed"), error);
      }
      if (selected === undefined) return; // 用户取消选择时保留原路径。
      const next = { ...paths, [field]: selected };
      set_paths(next);
      if (next.font_path === null || next.game_path === null) return;
      set_status("checking");
      try {
        await api_fetch("/api/toolbox/game-font/inspect", next);
        set_status("ready");
      } catch (error) {
        set_status("idle");
        push_error_toast(t("game_font_page.feedback.inspect_failed"), error);
      }
    },
    [paths, t],
  );

  /** 后端重新识别并持有写入占用，前端只等待最终结果。 */
  const confirm_apply = useCallback(async (): Promise<void> => {
    set_confirm_open(false);
    set_status("running");
    try {
      await run_modal_progress_toast({
        message: t("game_font_page.feedback.applying"),
        task: () => api_fetch("/api/toolbox/game-font/apply", paths),
      });
      push_toast("success", t("game_font_page.feedback.apply_success"));
    } catch (error) {
      push_error_toast(t("game_font_page.feedback.apply_failed"), error);
    } finally {
      set_status("ready");
    }
  }, [paths, t]);

  return {
    paths,
    status,
    confirm_open,
    pick_font_file: () => pick(window.desktopApp.pickGameFontFilePath, "font_path"),
    pick_game_executable: () => pick(window.desktopApp.pickGameExecutablePath, "game_path"),
    request_apply: () => set_confirm_open(true),
    confirm_apply,
    close_confirm: () => set_confirm_open(false),
  };
}
