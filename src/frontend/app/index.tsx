import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { ThemeProvider, useTheme } from "next-themes";

import {
  DEFAULT_ROUTE_ID,
  BOTTOM_ACTIONS,
  NAVIGATION_GROUPS,
} from "@frontend/app/navigation/schema";
import { SCREEN_REGISTRY } from "@frontend/app/navigation/screen-registry";
import { AppNavigationProvider } from "@frontend/app/navigation/navigation-context";
import { DesktopStateProvider } from "@frontend/app/state/desktop-state-context";
import { ProjectSessionProvider } from "@frontend/app/session/project-session-context";
import { ProjectSessionUiStateProvider } from "@frontend/app/session/project-session-ui-state-context";
import { WorkbenchTasksSessionProvider } from "@frontend/app/session/workbench-tasks/workbench-tasks-session-context";
import { QualityRuleStatisticsProvider } from "@frontend/app/session/quality-rule-statistics-context";
import {
  api_fetch,
  check_github_release_update,
  get_backend_metadata,
  open_external_url,
  type GithubReleaseUpdate,
} from "@frontend/app/desktop/desktop-api";
import {
  summarize_project_state_for_diagnostics,
  summarize_task_snapshot_for_diagnostics,
} from "@frontend/app/state/desktop-diagnostics";
import { update_renderer_diagnostics_context } from "@frontend/app/diagnostics/renderer-error-reporter";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import {
  DesktopProgressToastModalLayer,
  useDesktopToast,
} from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import "@frontend/app/shell/app-shell.css";
import type {
  AppearanceMenuActionId,
  BottomActionId,
  RouteId,
} from "@frontend/app/navigation/types";
import { LocaleProvider, useI18n } from "@frontend/app/locale/locale-provider";
import { SidebarInset, SidebarProvider } from "@frontend/shadcn/sidebar";
import { Toaster } from "@frontend/shadcn/sonner";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AppSidebar } from "@frontend/app/shell/app-sidebar";
import { AppTitlebar } from "@frontend/app/shell/app-titlebar";
import { AppAlertDialog } from "@frontend/widgets/app-alert-dialog";
import { LogWindowPage } from "@frontend/pages/log-window-page/page";
import type {
  DesktopUpdateDownloadProgress,
  DesktopUpdateDownloadResult,
  ThemeMode,
} from "@gui/bridge-types";

// SIDEBAR STORAGE KEY 是持久化或快捷键契约，集中保存避免调用点散落魔术字符串。
const SIDEBAR_STORAGE_KEY = "lg-sidebar-collapsed";
// THEME STORAGE KEY 是持久化或快捷键契约，集中保存避免调用点散落魔术字符串。
const THEME_STORAGE_KEY = "lg-theme-mode";
// FONT FAMILY STORAGE KEY 是持久化或快捷键契约，集中保存避免调用点散落魔术字符串。
const FONT_FAMILY_STORAGE_KEY = "lg-base-font-mode";
const LOG_WINDOW_APP_LANGUAGE_STORAGE_KEY = "lg-log-window-app-language"; // 日志窗口不启动主运行态，首屏语言用独立缓存兜底
const GITHUB_REPOSITORY_URL = "https://github.com/neavo/LinguaGacha";

type UpdateDialogState =
  | { phase: "idle" }
  | { phase: "available"; release: GithubReleaseUpdate; zip_path: string | null }
  | { phase: "confirming"; release: GithubReleaseUpdate }
  | { phase: "downloading"; release: GithubReleaseUpdate; progress_percent: number }
  | { phase: "ready_to_restart"; release: GithubReleaseUpdate; zip_path: string }
  | { phase: "launching"; release: GithubReleaseUpdate; zip_path: string };
type AppTranslator = ReturnType<typeof useI18n>["t"];

// PROJECT DEPENDENT ROUTE IDS 是模块级稳定契约，集中维护避免调用点散落魔术值。
const PROJECT_DEPENDENT_ROUTE_IDS: ReadonlySet<RouteId> = new Set([
  "proofreading",
  "workbench",
  "glossary",
  "text-preserve",
  "pre-translation-replacement",
  "post-translation-replacement",
  "translation-prompt",
  "analysis-prompt",
  "laboratory",
  "toolbox",
]);

// ROUTE IDS DISABLED WHEN PROJECT UNLOADED 是模块级稳定契约，集中维护避免调用点散落魔术值。
const ROUTE_IDS_DISABLED_WHEN_PROJECT_UNLOADED: ReadonlySet<RouteId> = new Set([
  "glossary",
  "text-preserve",
  "pre-translation-replacement",
  "post-translation-replacement",
  "translation-prompt",
  "analysis-prompt",
  "laboratory",
  "toolbox",
]);

/**
 * 解析当前场景的最终消费值。
 */
function resolve_toggled_app_language(app_language: "ZH" | "EN"): "ZH" | "EN" {
  if (app_language === "EN") {
    return "ZH";
  }

  return "EN";
}

/**
 * 从更新弹窗状态中读取当前 release，idle 阶段没有可消费版本。
 */
function read_update_release(state: UpdateDialogState): GithubReleaseUpdate | null {
  return state.phase === "idle" ? null : state.release;
}

/**
 * 判断更新弹窗当前是否需要保持可见。
 */
function is_update_dialog_open(state: UpdateDialogState): boolean {
  return (
    state.phase === "confirming" ||
    state.phase === "downloading" ||
    state.phase === "ready_to_restart" ||
    state.phase === "launching"
  );
}

/**
 * 判断更新弹窗是否处于不可关闭的提交阶段。
 */
function is_update_dialog_submitting(state: UpdateDialogState): boolean {
  return state.phase === "downloading" || state.phase === "launching";
}

/**
 * 格式化下载进度，避免按钮文本出现越界数值。
 */
function format_update_progress_label(progress_percent: number): string {
  return `${Math.max(0, Math.min(100, progress_percent)).toFixed(2)}%`;
}

/**
 * 根据更新状态解析确认按钮展示文本。
 */
function resolve_update_confirm_label(state: UpdateDialogState, t: AppTranslator): string {
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

/**
 * 解析当前场景的最终消费值。
 */
function resolve_selectable_route(route_id: RouteId): RouteId {
  if (route_id === "text-replacement") {
    return "pre-translation-replacement";
  } else if (route_id === "custom-prompt") {
    return "translation-prompt";
  } else {
    return route_id;
  }
}

/**
 * 判断当前值是否满足业务条件。
 */
function has_registered_screen(route_id: RouteId): boolean {
  return SCREEN_REGISTRY[route_id] !== undefined;
}

// 只读取边界事实并返回稳定快照，不在读取阶段产生写入副作用。
/**
 * 读取当前场景需要的稳定数据。
 */
function read_sidebar_state(): boolean {
  const stored_sidebar_state = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);

  if (stored_sidebar_state === "true") {
    return true;
  } else {
    return false;
  }
}

// 只读取边界事实并返回稳定快照，不在读取阶段产生写入副作用。
/**
 * 读取当前场景需要的稳定数据。
 */
function read_theme_mode(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const stored_theme = window.localStorage.getItem(THEME_STORAGE_KEY);

  if (stored_theme === "light" || stored_theme === "dark") {
    return stored_theme;
  } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  } else {
    return "light";
  }
}

// 只读取边界事实并返回稳定快照，不在读取阶段产生写入副作用。
/**
 * 读取当前场景需要的稳定数据。
 */
function read_lg_base_font_enabled(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  const stored_font_mode = window.localStorage.getItem(FONT_FAMILY_STORAGE_KEY);

  if (stored_font_mode === "disabled") {
    return false;
  } else {
    return true;
  }
}

/**
 * 承接当前模块的核心控制分支。
 */
function serialize_lg_base_font_mode(is_enabled: boolean): "enabled" | "disabled" {
  return is_enabled ? "enabled" : "disabled";
}

// 收口外部文本解析，解析失败时由这里决定降级口径。
/**
 * 解析输入并收窄为业务可用值。
 */
function parse_lg_base_font_mode(stored_font_mode: string | null): boolean {
  return stored_font_mode !== "disabled";
}

/**
 * 判断当前值是否满足业务条件。
 */
function is_log_window_mode(): boolean {
  return new URLSearchParams(window.location.search).get("window") === "logs";
}

// 统一生成日志或 UI 展示文本，避免多处拼接造成口径漂移。
/**
 * 生成当前场景的展示内容。
 */
function format_app_titlebar_title(app_name: string, version: string | null): string {
  const normalized_version = version?.trim();
  if (normalized_version === undefined || normalized_version === "") {
    return app_name;
  }

  const version_label =
    normalized_version.match(/^v/iu) === null ? `v${normalized_version}` : normalized_version;
  return `${app_name} ${version_label}`;
}

/**
 * 承接当前模块的核心控制分支。
 */
function useLgBaseFontMode(): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [is_lg_base_font_enabled, set_is_lg_base_font_enabled] = useState<boolean>(() =>
    read_lg_base_font_enabled(),
  );

  useEffect(() => {
    const font_mode = serialize_lg_base_font_mode(is_lg_base_font_enabled);

    document.documentElement.dataset.lgBaseFont = font_mode;
    if (window.localStorage.getItem(FONT_FAMILY_STORAGE_KEY) !== font_mode) {
      window.localStorage.setItem(FONT_FAMILY_STORAGE_KEY, font_mode);
    }
  }, [is_lg_base_font_enabled]);

  useEffect(() => {
    // 事件处理边界，只把外部事件转换为本模块状态更新。
    /**
     * 承接当前模块的核心控制分支。
     */
    function handle_storage(event: StorageEvent): void {
      if (event.key !== FONT_FAMILY_STORAGE_KEY) {
        return;
      }

      set_is_lg_base_font_enabled(parse_lg_base_font_mode(event.newValue));
    }

    window.addEventListener("storage", handle_storage);

    return () => {
      window.removeEventListener("storage", handle_storage);
    };
  }, []);

  return [is_lg_base_font_enabled, set_is_lg_base_font_enabled];
}

type AppContentProps = {
  is_lg_base_font_enabled: boolean;
  set_is_lg_base_font_enabled: Dispatch<SetStateAction<boolean>>;
};

type LogWindowSettingsPayload = {
  settings?: {
    app_language?: unknown;
  };
};

/**
 * 渲染当前组件的公开界面。
 */
function AppContent(props: AppContentProps): JSX.Element {
  const {
    initial_state_ready,
    pending_target_route,
    is_app_language_updating,
    project_snapshot,
    project_session_status,
    settings_snapshot,
    set_pending_target_route,
    task_snapshot,
    update_app_language,
  } = useDesktopState();
  const { push_toast } = useDesktopToast();
  const { t } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const shell_info = window.desktopApp.shell;
  const [selected_route, set_selected_route] = useState<RouteId>(DEFAULT_ROUTE_ID);
  const [expanded_items, set_expanded_items] = useState<Set<RouteId>>(() => new Set());
  const [is_sidebar_collapsed, set_is_sidebar_collapsed] = useState<boolean>(() =>
    read_sidebar_state(),
  );
  const [app_version, set_app_version] = useState<string | null>(null);
  const [update_dialog_state, set_update_dialog_state] = useState<UpdateDialogState>({
    phase: "idle",
  });
  const [close_confirm_open, set_close_confirm_open] = useState<boolean>(false);
  const [close_confirm_submitting, set_close_confirm_submitting] = useState<boolean>(false);
  const previous_project_loaded_ref = useRef<boolean>(project_snapshot.loaded);
  const previous_project_path_ref = useRef<string>(project_snapshot.path);
  const previous_project_session_status_ref = useRef(project_session_status);
  const log_badge_project_path_ref = useRef<string | null>(null);
  const system_proxy_toast_shown_ref = useRef<boolean>(false); // 系统代理提示只展示一次，避免初始状态读取或语言刷新重复打扰用户
  const [log_badge_visible, set_log_badge_visible] = useState<boolean>(false);
  const active_screen = SCREEN_REGISTRY[selected_route] ?? SCREEN_REGISTRY[DEFAULT_ROUTE_ID]!;
  const ScreenComponent = active_screen.component;
  const app_title = t("app.metadata.app_name");
  const app_titlebar_title = format_app_titlebar_title(app_title, app_version);
  const update_release = read_update_release(update_dialog_state);
  const update_release_url = update_release?.release_url ?? null;
  const theme_mode: ThemeMode =
    resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : read_theme_mode();

  useEffect(() => {
    update_renderer_diagnostics_context({
      route: selected_route,
      project: summarize_project_state_for_diagnostics({
        loaded: project_snapshot.loaded,
        path: project_snapshot.path,
        sessionStatus: project_session_status,
      }),
      task: summarize_task_snapshot_for_diagnostics(task_snapshot),
    });
  }, [
    project_snapshot.loaded,
    project_snapshot.path,
    project_session_status,
    selected_route,
    task_snapshot,
  ]);

  useEffect(() => {
    window.desktopApp.setTitleBarTheme(theme_mode);
  }, [theme_mode]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(is_sidebar_collapsed));
  }, [is_sidebar_collapsed]);

  useEffect(() => {
    let is_disposed = false;

    void get_backend_metadata()
      .then((metadata) => {
        if (!is_disposed) {
          set_app_version(metadata.version);
        }
      })
      .catch(() => {
        if (!is_disposed) {
          set_app_version(null);
        }
      });

    return () => {
      is_disposed = true;
    };
  }, []);

  useEffect(() => {
    if (app_version === null) {
      return;
    }

    let is_disposed = false;

    void check_github_release_update(app_version).then((release_update) => {
      if (!is_disposed && release_update !== null) {
        set_update_dialog_state({
          phase: "confirming",
          release: release_update,
        });
      }
    });

    return () => {
      is_disposed = true;
    };
  }, [app_version]);

  useEffect(() => {
    if (!initial_state_ready || system_proxy_toast_shown_ref.current) {
      return;
    }

    if (!window.desktopApp.backendApi.systemProxyStartupNotice.detected) {
      return;
    }

    system_proxy_toast_shown_ref.current = true;
    push_toast(
      "info",
      t("app.system_proxy.startup_notice", {
        PROXY: window.desktopApp.backendApi.systemProxyStartupNotice.proxyDisplay ?? "",
      }),
    );
  }, [initial_state_ready, push_toast, t]);

  useEffect(() => {
    document.title = app_title;
  }, [app_title]);

  useEffect(() => {
    return window.desktopApp.onWindowCloseRequest(() => {
      set_close_confirm_open(true);
    });
  }, []);

  useEffect(() => {
    if (!initial_state_ready) {
      return;
    }

    const was_loaded = previous_project_loaded_ref.current;
    const previous_project_path = previous_project_path_ref.current;
    const previous_project_session_status = previous_project_session_status_ref.current;
    previous_project_loaded_ref.current = project_snapshot.loaded;
    previous_project_path_ref.current = project_snapshot.path;
    previous_project_session_status_ref.current = project_session_status;

    if (was_loaded && !project_snapshot.loaded) {
      set_selected_route(DEFAULT_ROUTE_ID);
      set_pending_target_route(null);
      return;
    }

    if (!project_snapshot.loaded || project_session_status !== "ready") {
      return;
    }

    const project_just_loaded = !was_loaded;
    const project_path_changed = previous_project_path !== project_snapshot.path;
    const session_just_became_ready = previous_project_session_status !== "ready";

    if (project_just_loaded || project_path_changed || session_just_became_ready) {
      if (pending_target_route !== null) {
        set_selected_route(resolve_selectable_route(pending_target_route));
        set_pending_target_route(null);
      } else if (
        selected_route === DEFAULT_ROUTE_ID ||
        project_just_loaded ||
        project_path_changed ||
        session_just_became_ready
      ) {
        set_selected_route("workbench");
      }
    }
  }, [
    initial_state_ready,
    pending_target_route,
    project_snapshot.loaded,
    project_snapshot.path,
    project_session_status,
    selected_route,
    set_pending_target_route,
  ]);

  const disabled_route_ids = useMemo<ReadonlySet<RouteId>>(() => {
    if (!project_snapshot.loaded) {
      return new Set(ROUTE_IDS_DISABLED_WHEN_PROJECT_UNLOADED);
    }

    if (project_session_status === "ready") {
      return new Set();
    }

    return new Set(PROJECT_DEPENDENT_ROUTE_IDS);
  }, [project_snapshot.loaded, project_session_status]);
  const badged_bottom_action_ids = useMemo<ReadonlySet<BottomActionId>>(() => {
    return log_badge_visible ? new Set<BottomActionId>(["logs"]) : new Set();
  }, [log_badge_visible]);

  const visible_navigation_groups = useMemo(() => {
    return NAVIGATION_GROUPS.filter((group) => {
      return group.items.some((item) => {
        if ((item.children?.length ?? 0) > 0) {
          return item.children?.some((child) => has_registered_screen(child.id)) ?? false;
        }

        return has_registered_screen(item.id);
      });
    }).map((group) => {
      return {
        ...group,
        items: group.items
          .filter((item) => {
            if ((item.children?.length ?? 0) > 0) {
              return item.children?.some((child) => has_registered_screen(child.id)) ?? false;
            }

            return has_registered_screen(item.id);
          })
          .map((item) => {
            if ((item.children?.length ?? 0) === 0) {
              return item;
            }

            return {
              ...item,
              children: item.children?.filter((child) => {
                return has_registered_screen(child.id);
              }),
            };
          }),
      };
    });
  }, []);

  // 事件处理边界，只把外部事件转换为本模块状态更新。
  /**
   * 承接当前模块的核心控制分支。
   */
  function handle_select_route(route_id: RouteId): void {
    const next_route = resolve_selectable_route(route_id);

    if (!project_snapshot.loaded && PROJECT_DEPENDENT_ROUTE_IDS.has(next_route)) {
      set_pending_target_route(next_route);
      set_selected_route(DEFAULT_ROUTE_ID);
      return;
    }

    if (
      project_snapshot.loaded &&
      project_session_status !== "ready" &&
      PROJECT_DEPENDENT_ROUTE_IDS.has(next_route)
    ) {
      set_pending_target_route(next_route);
      set_selected_route(DEFAULT_ROUTE_ID);
      return;
    }

    if (!PROJECT_DEPENDENT_ROUTE_IDS.has(next_route)) {
      set_pending_target_route(null);
    }

    set_selected_route(next_route);
  }

  useEffect(() => {
    if (!project_snapshot.loaded) {
      log_badge_project_path_ref.current = null;
      set_log_badge_visible(false);
      return;
    }

    const project_path = project_snapshot.path.trim();
    if (project_path === "" || project_session_status !== "ready") {
      return;
    }

    if (log_badge_project_path_ref.current === project_path) {
      return;
    }

    log_badge_project_path_ref.current = project_path;
    set_log_badge_visible(true);
  }, [project_snapshot.loaded, project_snapshot.path, project_session_status]);

  // 事件处理边界，只把外部事件转换为本模块状态更新。
  /**
   * 承接当前模块的核心控制分支。
   */
  function handle_toggle_group(route_id: RouteId): void {
    if (is_sidebar_collapsed) {
      set_is_sidebar_collapsed(false);
      set_expanded_items((previous_items) => {
        const next_items = new Set(previous_items);
        next_items.add(route_id);
        return next_items;
      });
    } else {
      set_expanded_items((previous_items) => {
        const next_items = new Set(previous_items);

        if (next_items.has(route_id)) {
          next_items.delete(route_id);
        } else {
          next_items.add(route_id);
        }

        return next_items;
      });
    }
  }

  // 事件处理边界，只把外部事件转换为本模块状态更新。
  /**
   * 承接当前模块的核心控制分支。
   */
  function handle_bottom_action(action_id: BottomActionId): void {
    if (action_id === "logs") {
      set_log_badge_visible(false);
      void window.desktopApp.openLogWindow().catch((error: unknown) => {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("app.feedback.update_failed")),
        );
      });
      return;
    }

    if (action_id !== "language") {
      return;
    }

    void update_app_language(resolve_toggled_app_language(settings_snapshot.app_language)).catch(
      (error: unknown) => {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("app.feedback.update_failed")),
        );
      },
    );
  }

  // 事件处理边界，只把外部事件转换为本模块状态更新。
  /**
   * 承接当前模块的核心控制分支。
   */
  function handle_appearance_menu_action(action_id: AppearanceMenuActionId): void {
    if (action_id === "theme-mode") {
      if (theme_mode === "light") {
        setTheme("dark");
      } else {
        setTheme("light");
      }
    } else {
      props.set_is_lg_base_font_enabled(!props.is_lg_base_font_enabled);
    }
  }

  /**
   * 关闭更新弹窗时保留已发现版本，便于用户稍后从侧栏重新打开。
   */
  function close_update_dialog(): void {
    set_update_dialog_state((current_state) => {
      if (current_state.phase === "confirming") {
        return {
          phase: "available",
          release: current_state.release,
          zip_path: null,
        };
      }
      if (current_state.phase === "ready_to_restart") {
        return {
          phase: "available",
          release: current_state.release,
          zip_path: current_state.zip_path,
        };
      }

      return current_state;
    });
  }

  /**
   * 从侧栏状态入口重新打开更新弹窗，已下载完成时直接进入重启确认。
   */
  function reopen_update_dialog(): void {
    set_update_dialog_state((current_state) => {
      if (current_state.phase !== "available") {
        return current_state;
      }
      if (current_state.zip_path !== null) {
        return {
          phase: "ready_to_restart",
          release: current_state.release,
          zip_path: current_state.zip_path,
        };
      }

      return {
        phase: "confirming",
        release: current_state.release,
      };
    });
  }

  /**
   * 只在下载阶段接收进度，避免迟到 IPC 事件覆盖其它状态。
   */
  function handle_update_download_progress(progress: DesktopUpdateDownloadProgress): void {
    set_update_dialog_state((current_state) => {
      if (current_state.phase !== "downloading") {
        return current_state;
      }

      return {
        ...current_state,
        progress_percent: progress.progress_percent,
      };
    });
  }

  /**
   * 串起下载、回退发布页和启动更新器三个更新确认分支。
   */
  async function handle_confirm_update_dialog(): Promise<void> {
    if (update_dialog_state.phase === "confirming") {
      const release = update_dialog_state.release;
      set_update_dialog_state({
        phase: "downloading",
        release,
        progress_percent: 0,
      });
      try {
        const result = await window.desktopApp.downloadUpdate(
          {
            latest_version: release.latest_version,
            release_url: release.release_url,
            windows_zip_urls: release.windows_zip_urls,
          },
          handle_update_download_progress,
        );
        handle_update_download_result(release, result);
      } catch (error) {
        set_update_dialog_state({
          phase: "confirming",
          release,
        });
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("app.feedback.update_failed")),
        );
      }
      return;
    }

    if (update_dialog_state.phase !== "ready_to_restart") {
      return;
    }

    const release = update_dialog_state.release;
    const zip_path = update_dialog_state.zip_path;
    set_update_dialog_state({
      phase: "launching",
      release,
      zip_path,
    });
    try {
      await window.desktopApp.launchUpdate({
        latest_version: release.latest_version,
        zip_path,
      });
    } catch (error) {
      set_update_dialog_state({
        phase: "ready_to_restart",
        release,
        zip_path,
      });
      push_toast("error", resolve_visible_error_message(error, t, t("app.feedback.update_failed")));
    }
  }

  /**
   * 把 main 返回的下载结果转换为 renderer 弹窗状态或发布页回退。
   */
  function handle_update_download_result(
    release: GithubReleaseUpdate,
    result: DesktopUpdateDownloadResult,
  ): void {
    if (result.status === "fallback_to_release_page") {
      set_update_dialog_state({
        phase: "available",
        release,
        zip_path: null,
      });
      void open_external_url(result.release_url).catch((error: unknown) => {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("app.feedback.update_failed")),
        );
      });
      return;
    }

    set_update_dialog_state({
      phase: "ready_to_restart",
      release,
      zip_path: result.zip_path,
    });
  }

  // 事件处理边界，只把外部事件转换为本模块状态更新。
  /**
   * 承接当前模块的核心控制分支。
   */
  function handle_profile_action(): void {
    if (update_release !== null) {
      reopen_update_dialog();
      return;
    }

    void open_external_url(GITHUB_REPOSITORY_URL).catch((error: unknown) => {
      push_toast("error", resolve_visible_error_message(error, t, t("app.feedback.update_failed")));
    });
  }

  // handle_confirm_window_close 是事件处理边界，只把外部事件转换为本模块状态更新。
  /**
   * 承接当前模块的核心控制分支。
   */
  async function handle_confirm_window_close(): Promise<void> {
    set_close_confirm_submitting(true);
    try {
      await window.desktopApp.quitApp();
    } catch (error) {
      set_close_confirm_submitting(false);
      push_toast("error", resolve_visible_error_message(error, t, t("app.feedback.update_failed")));
    }
  }

  return (
    <>
      <SidebarProvider
        open={!is_sidebar_collapsed}
        onOpenChange={(is_open) => {
          set_is_sidebar_collapsed(!is_open); // 统一由应用根持有折叠态，这样标题栏按钮和 sidebar 语义状态始终一致
        }}
        style={
          {
            "--sidebar-width": "256px",
            "--sidebar-width-icon": "72px",
          } as CSSProperties
        }
      >
        <main
          className="app-shell"
          style={
            {
              "--titlebar-height": `${shell_info.titleBarHeight}px`,
              "--titlebar-safe-area-start": `${shell_info.titleBarSafeAreaStart}px`,
              "--titlebar-safe-area-end": `${shell_info.titleBarSafeAreaEnd}px`,
            } as CSSProperties
          }
        >
          <AppTitlebar title={app_titlebar_title} />
          <section className="shell-body">
            <AppSidebar
              groups={visible_navigation_groups}
              bottom_actions={BOTTOM_ACTIONS}
              selected_route={selected_route}
              expanded_items={expanded_items}
              disabled_route_ids={disabled_route_ids}
              disabled_bottom_action_ids={
                is_app_language_updating ? new Set<BottomActionId>(["language"]) : new Set()
              }
              badged_bottom_action_ids={badged_bottom_action_ids}
              profile_label_key={
                update_release_url === null ? "app.profile.status" : "app.profile.update_available"
              }
              profile_tooltip_key={
                update_release_url === null
                  ? "app.profile.status_tooltip"
                  : "app.profile.update_available_tooltip"
              }
              is_profile_update_available={update_release_url !== null}
              on_select_route={handle_select_route}
              on_toggle_group={handle_toggle_group}
              on_bottom_action={handle_bottom_action}
              on_appearance_menu_action={handle_appearance_menu_action}
              on_profile_action={handle_profile_action}
            />

            <SidebarInset className="workspace-frame" aria-label={t(active_screen.title_key)}>
              <AppNavigationProvider
                selected_route={selected_route}
                navigate_to_route={handle_select_route}
              >
                <ProjectSessionProvider>
                  {/* 项目 session UI 状态必须位于 session barrier 内，随项目身份清空且不参与缓存门闩。 */}
                  <ProjectSessionUiStateProvider>
                    <WorkbenchTasksSessionProvider>
                      <QualityRuleStatisticsProvider>
                        <ScreenComponent is_sidebar_collapsed={is_sidebar_collapsed} />
                      </QualityRuleStatisticsProvider>
                    </WorkbenchTasksSessionProvider>
                  </ProjectSessionUiStateProvider>
                </ProjectSessionProvider>
              </AppNavigationProvider>
            </SidebarInset>
          </section>
        </main>
      </SidebarProvider>

      <AppAlertDialog
        open={is_update_dialog_open(update_dialog_state)}
        description={
          update_release === null
            ? ""
            : t("app.update.confirm_description", { VERSION: update_release.latest_version })
        }
        submitting={is_update_dialog_submitting(update_dialog_state)}
        submittingLabel={resolve_update_confirm_label(update_dialog_state, t)}
        submittingIcon={update_dialog_state.phase === "launching"}
        confirmLabel={resolve_update_confirm_label(update_dialog_state, t)}
        cancelLabel={t("app.action.cancel")}
        onConfirm={handle_confirm_update_dialog}
        onClose={close_update_dialog}
      />

      <AppAlertDialog
        open={close_confirm_open}
        description={t("app.close_confirm.description")}
        submitting={close_confirm_submitting}
        onConfirm={handle_confirm_window_close}
        onClose={() => {
          set_close_confirm_open(false);
        }}
      />
    </>
  );
}

// 在边界处归一化输入，避免下游再处理坏载荷分支。
/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_log_window_app_language(value: unknown): "ZH" | "EN" {
  const normalized_value = String(value ?? "")
    .trim()
    .toUpperCase();
  if (normalized_value === "EN" || normalized_value.startsWith("EN-")) {
    return "EN";
  }

  return "ZH";
}

// 只读取边界事实并返回稳定快照，不在读取阶段产生写入副作用。
/**
 * 读取当前场景需要的稳定数据。
 */
function read_initial_log_window_app_language(): "ZH" | "EN" {
  const stored_language = window.localStorage.getItem(LOG_WINDOW_APP_LANGUAGE_STORAGE_KEY);
  return normalize_log_window_app_language(stored_language ?? window.navigator.language);
}

/**
 * 渲染当前组件的公开界面。
 */
function WindowVisualProviders({ children }: { children: ReactNode }): JSX.Element {
  // 多窗口共享的视觉壳层只承载主题、tooltip 和提示，不读取项目或任务运行态
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={read_theme_mode()}
      enableSystem={false}
      storageKey={THEME_STORAGE_KEY}
      themes={["light", "dark"]}
    >
      <TooltipProvider delayDuration={120}>
        {children}
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}

/**
 * 渲染当前组件的公开界面。
 */
function MainWindowLocaleProvider({ children }: { children: ReactNode }): JSX.Element {
  const { settings_snapshot } = useDesktopState();

  // 主窗口语言仍跟随 DesktopStateProvider 的 settings 快照，避免页面各自读取设置
  return <LocaleProvider app_language={settings_snapshot.app_language}>{children}</LocaleProvider>;
}

/**
 * 渲染当前组件的公开界面。
 */
function MainWindowApp(props: AppContentProps): JSX.Element {
  // 只有主窗口拥有项目、任务、设置和主事件流运行态
  return (
    <DesktopStateProvider>
      <MainWindowLocaleProvider>
        <WindowVisualProviders>
          <AppContent
            is_lg_base_font_enabled={props.is_lg_base_font_enabled}
            set_is_lg_base_font_enabled={props.set_is_lg_base_font_enabled}
          />
          <DesktopProgressToastModalLayer />
        </WindowVisualProviders>
      </MainWindowLocaleProvider>
    </DesktopStateProvider>
  );
}

/**
 * 渲染当前组件的公开界面。
 */
function LogWindowApp(): JSX.Element {
  const [app_language, set_app_language] = useState<"ZH" | "EN">(() =>
    read_initial_log_window_app_language(),
  );

  useEffect(() => {
    let is_disposed = false;

    // 日志窗口只轻量读取一次设置语言，不订阅 project/task 主事件流
    void api_fetch<LogWindowSettingsPayload>("/api/settings/app", {})
      .then((payload) => {
        if (is_disposed) {
          return;
        }
        const next_app_language = normalize_log_window_app_language(payload.settings?.app_language);
        window.localStorage.setItem(LOG_WINDOW_APP_LANGUAGE_STORAGE_KEY, next_app_language);
        set_app_language(next_app_language);
      })
      .catch(() => undefined); // 设置读取失败时保留首屏兜底语言，日志流本身不受影响

    return () => {
      is_disposed = true;
    };
  }, []);

  return (
    <LocaleProvider app_language={app_language}>
      <WindowVisualProviders>
        <LogWindowPage />
      </WindowVisualProviders>
    </LocaleProvider>
  );
}

/**
 * 渲染当前组件的公开界面。
 */
function App(): JSX.Element {
  const [is_lg_base_font_enabled, set_is_lg_base_font_enabled] = useLgBaseFontMode();

  if (is_log_window_mode()) {
    return <LogWindowApp />;
  }

  return (
    <MainWindowApp
      is_lg_base_font_enabled={is_lg_base_font_enabled}
      set_is_lg_base_font_enabled={set_is_lg_base_font_enabled}
    />
  );
}

export default App;
