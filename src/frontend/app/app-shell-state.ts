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
  key: "app.action.confirm" | "app.update.launching" | "app.update.restart_confirm",
) => string;

const PROJECT_LOAD_ENTRY_ROUTE_IDS: ReadonlySet<RouteId> = new Set([
  "agent",
  "proofreading",
  "workbench",
]);
const PROJECT_LOADED_ONLY_ROUTE_IDS: ReadonlySet<RouteId> = new Set([
  "glossary",
  "text-preserve",
  "pre-translation-replacement",
  "post-translation-replacement",
  "custom-prompt",
  "laboratory",
  "toolbox",
]);

/** 识别需要项目会话才能进入的路由。 */
function is_project_dependent_route(route_id: RouteId): boolean {
  return PROJECT_LOAD_ENTRY_ROUTE_IDS.has(route_id) || PROJECT_LOADED_ONLY_ROUTE_IDS.has(route_id);
}

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
export function resolve_update_confirm_label(state: UpdateDialogState, t: AppTranslator): string {
  if (state.phase === "ready_to_restart") {
    return t("app.update.restart_confirm");
  }
  if (state.phase === "downloading") {
    return format_update_progress_label(state.progress_percent);
  }
  if (state.phase === "launching") {
    return t("app.update.launching");
  }

  return t("app.action.confirm");
}

/** 将替换功能分组解析为默认可访问页面。 */
export function resolve_selectable_route(route_id: RouteId): RouteId {
  if (route_id === "text-replacement") {
    return "pre-translation-replacement";
  }
  return route_id;
}

/** 按项目加载与准备状态计算可用入口。 */
export function resolve_disabled_route_ids(args: {
  project_loaded: boolean;
  project_session_status: ProjectSessionStatus;
}): ReadonlySet<RouteId> {
  if (!args.project_loaded) {
    return new Set(PROJECT_LOADED_ONLY_ROUTE_IDS);
  }

  return args.project_session_status === "ready"
    ? new Set()
    : new Set([...PROJECT_LOAD_ENTRY_ROUTE_IDS, ...PROJECT_LOADED_ONLY_ROUTE_IDS]);
}

/** 项目尚未就绪时保留目标，供会话准备后恢复。 */
export function resolve_route_selection(args: {
  route_id: RouteId;
  project_loaded: boolean;
  project_session_status: ProjectSessionStatus;
  pending_target_route: RouteId | null;
}): { selected_route: RouteId; pending_target_route: RouteId | null } {
  const next_route = resolve_selectable_route(args.route_id);
  if (
    is_project_dependent_route(next_route) &&
    (!args.project_loaded || args.project_session_status !== "ready")
  ) {
    return { selected_route: DEFAULT_ROUTE_ID, pending_target_route: next_route };
  }

  return {
    selected_route: next_route,
    pending_target_route: is_project_dependent_route(next_route) ? args.pending_target_route : null,
  };
}

/** 项目关闭时回首页，新会话就绪后恢复待访问页面。 */
export function resolve_project_route_after_snapshot(args: {
  previous_project_loaded: boolean;
  previous_project_path: string;
  previous_project_session_status: ProjectSessionStatus;
  project_loaded: boolean;
  project_path: string;
  project_session_status: ProjectSessionStatus;
  pending_target_route: RouteId | null;
}): { selected_route: RouteId; pending_target_route: RouteId | null } | null {
  if (args.previous_project_loaded && !args.project_loaded) {
    return { selected_route: DEFAULT_ROUTE_ID, pending_target_route: null };
  }
  if (!args.project_loaded || args.project_session_status !== "ready") {
    return null;
  }

  const project_changed =
    !args.previous_project_loaded ||
    args.previous_project_path !== args.project_path ||
    args.previous_project_session_status !== "ready";
  if (!project_changed) {
    return null;
  }

  return {
    selected_route:
      args.pending_target_route === null
        ? "workbench"
        : resolve_selectable_route(args.pending_target_route),
    pending_target_route: null,
  };
}
