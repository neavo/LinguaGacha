import type { GithubReleaseUpdate } from "@frontend/app/desktop/desktop-api";

export type UpdateDialogState =
  | { phase: "idle" }
  | { phase: "available"; release: GithubReleaseUpdate; zip_path: string | null }
  | { phase: "confirming"; release: GithubReleaseUpdate }
  | { phase: "downloading"; release: GithubReleaseUpdate; progress_percent: number }
  | { phase: "ready_to_restart"; release: GithubReleaseUpdate; zip_path: string }
  | { phase: "launching"; release: GithubReleaseUpdate; zip_path: string };

type AppTranslator = (
  key: "app.update.action" | "app.update.launching" | "app.update.restart_confirm",
) => string;

/** 从更新流程当前阶段读取发行信息。 */
export function read_update_release(state: UpdateDialogState): GithubReleaseUpdate | null {
  return state.phase === "idle" ? null : state.release;
}

/** 仅在需要确认或等待更新操作时展示弹窗。 */
export function is_update_dialog_open(state: UpdateDialogState): boolean {
  return (
    state.phase === "confirming" ||
    state.phase === "downloading" ||
    state.phase === "ready_to_restart" ||
    state.phase === "launching"
  );
}

/** 下载和启动安装期间锁定重复提交。 */
export function is_update_dialog_submitting(state: UpdateDialogState): boolean {
  return state.phase === "downloading" || state.phase === "launching";
}

/** 限制进度范围并生成百分比标签。 */
export function format_update_progress_label(progress_percent: number): string {
  return `${Math.max(0, Math.min(100, progress_percent)).toFixed(2)}%`;
}

/** 由更新阶段选择主操作文案。 */
export function resolve_update_action_label(state: UpdateDialogState, t: AppTranslator): string {
  if (state.phase === "ready_to_restart") {
    return t("app.update.restart_confirm");
  }
  if (state.phase === "downloading") {
    return format_update_progress_label(state.progress_percent);
  }
  if (state.phase === "launching") {
    return t("app.update.launching");
  }

  return t("app.update.action");
}
