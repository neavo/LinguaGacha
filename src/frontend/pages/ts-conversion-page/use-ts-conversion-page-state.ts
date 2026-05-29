import { useCallback, useEffect, useRef, useState } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-provider";
import type {
  TsConversionDirection,
  TsConversionExportPayload,
} from "@frontend/pages/ts-conversion-page/types";

type TsConversionConfirmState = {
  open: boolean;
};

// 确认弹窗状态保持独立构造，避免关闭和初始化分支各自拼对象
/**
 * 构建当前场景的稳定结果。
 */
function create_empty_confirm_state(): TsConversionConfirmState {
  return {
    open: false,
  };
}

// 导出后缀沿用 旧写出链路的既有命名约定，页面只按方向选择
/**
 * 解析当前场景的最终消费值。
 */
// 页面状态只编排确认、进度和导出请求；实际转换规则留在纯逻辑模块
export function useTsConversionPageState() {
  const { t } = useI18n();
  const { project_snapshot, project_session_status = "ready" } = useDesktopState();
  const { push_toast, push_progress_toast, update_progress_toast, dismiss_toast } =
    useDesktopToast();
  const [direction, set_direction] = useState<TsConversionDirection>("s2t");
  const [preserve_text, set_preserve_text] = useState(true);
  const [convert_name, set_convert_name] = useState(true);
  const [confirm_state, set_confirm_state] = useState<TsConversionConfirmState>(() =>
    create_empty_confirm_state(),
  );
  const [is_running, set_is_running] = useState(false);
  const run_active_ref = useRef(false); // 用 ref 阻止同一轮异步转换被重复触发，避免重复写出文件
  const prefer_native_notice_shown_ref = useRef(false); // 页面挂载提示只在当前 hook 生命周期内展示一次

  useEffect(() => {
    if (prefer_native_notice_shown_ref.current) {
      return;
    }
    prefer_native_notice_shown_ref.current = true;
    push_toast("info", t("ts_conversion_page.feedback.prefer_native_traditional_chinese"));
  }, [push_toast, t]);

  // 请求阶段只做可执行性校验，不提前读取预设或生成转换结果
  const request_conversion = useCallback((): void => {
    if (run_active_ref.current) {
      push_toast("warning", t("ts_conversion_page.feedback.task_running"));
      return;
    }
    if (!project_snapshot.loaded) {
      push_toast("error", t("ts_conversion_page.feedback.project_required"));
      return;
    }
    if (project_session_status !== "ready") {
      push_toast("warning", t("ts_conversion_page.feedback.no_data"));
      return;
    }

    set_confirm_state({
      open: true,
    });
  }, [project_session_status, project_snapshot.loaded, push_toast, t]);

  const close_confirm_dialog = useCallback((): void => {
    set_confirm_state(create_empty_confirm_state());
  }, []);

  // 确认后串行完成预设读取、文本转换和文件导出，保证进度提示生命周期完整
  const confirm_conversion = useCallback(async (): Promise<void> => {
    if (run_active_ref.current) {
      return;
    }

    run_active_ref.current = true;
    set_is_running(true);
    set_confirm_state({
      open: false,
    });
    const progress_toast_id = push_progress_toast({
      message: t("ts_conversion_page.action.preparing"),
      presentation: "modal",
    });

    try {
      update_progress_toast(progress_toast_id, {
        message: t("ts_conversion_page.action.progress")
          .replace("{CURRENT}", "1")
          .replace("{TOTAL}", "1"),
        presentation: "modal",
      });
      await Promise.resolve();

      update_progress_toast(progress_toast_id, {
        message: t("ts_conversion_page.action.progress")
          .replace("{CURRENT}", "1")
          .replace("{TOTAL}", "1"),
        presentation: "modal",
      });

      await api_fetch<TsConversionExportPayload>("/api/toolbox/ts-conversion/files/export", {
        direction,
        convert_name,
        preserve_text,
      });
      dismiss_toast(progress_toast_id);
      push_toast("success", t("ts_conversion_page.feedback.task_success"));
    } catch (error) {
      dismiss_toast(progress_toast_id);
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("ts_conversion_page.feedback.task_failed")),
      );
    } finally {
      run_active_ref.current = false;
      set_is_running(false);
    }
  }, [
    convert_name,
    direction,
    dismiss_toast,
    preserve_text,
    push_progress_toast,
    push_toast,
    t,
    update_progress_toast,
  ]);

  return {
    direction,
    preserve_text,
    convert_name,
    confirm_state,
    is_running,
    set_direction,
    set_preserve_text,
    set_convert_name,
    request_conversion,
    confirm_conversion,
    close_confirm_dialog,
  };
}
