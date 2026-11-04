import type { GithubReleaseUpdate } from "@frontend/app/desktop/desktop-api";
import { DEFAULT_ROUTE_ID } from "@frontend/app/navigation/schema";
import type { RouteId } from "@frontend/app/navigation/types";

export type UpdateDialogState =
  | { phase: "idle" }
  | { phase: "available"; release: GithubReleaseUpdate; zip_path: string | null }
  | { phase: "confirming"; release: GithubReleaseUpdate }
  | { phase: "downloading"; release: GithubReleaseUpdate; progress_percent: number }
  | { phase: "ready_to_restart"; release: GithubReleaseUpdate; zip_path: string }
  | { phase: "launching"; release: GithubReleaseUpdate; zip_path: string };

type ProjectSessionStatus = "idle" | "warming" | "ready";
type AppTranslator = (
  key: "app.update.action" | "app.update.launching" | "app.update.restart_confirm",
) => string;

// 依赖工程会话的页面只在工程就绪时开放导航。
const PROJECT_ROUTE_IDS: ReadonlySet<RouteId> = new Set([
  "proofreading",
  "workbench",
  "glossary",
  "text-preserve",
  "pre-translation-replacement",
  "post-translation-replacement",
  "knowledge",
  "custom-prompt",
  "laboratory",
]);

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

/** 按项目加载与准备状态计算可用入口。 */
export function resolve_disabled_route_ids(args: {
  project_loaded: boolean;
  project_session_status: ProjectSessionStatus;
}): ReadonlySet<RouteId> {
  return args.project_loaded && args.project_session_status === "ready"
    ? new Set()
    : PROJECT_ROUTE_IDS;
}

/** 工程卸载时回到 AGENT，其余快照变化保持当前路由。 */
export function resolve_route_after_project_snapshot(args: {
  previous_project_loaded: boolean;
  project_loaded: boolean;
}): RouteId | null {
  return args.previous_project_loaded && !args.project_loaded ? DEFAULT_ROUTE_ID : null;
}
