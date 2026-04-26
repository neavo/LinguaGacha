import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ThemeProvider, useTheme } from "next-themes";

import { DEFAULT_ROUTE_ID, BOTTOM_ACTIONS, NAVIGATION_GROUPS } from "@/app/navigation/schema";
import { SCREEN_REGISTRY } from "@/app/navigation/screen-registry";
import { AppNavigationProvider } from "@/app/navigation/navigation-context";
import { DesktopRuntimeProvider } from "@/app/runtime/desktop/desktop-runtime-context";
import { ProjectPagesProvider } from "@/app/runtime/project-pages/project-pages-context";
import { QualityStatisticsProvider } from "@/app/project/quality/quality-statistics-context";
import {
  check_github_release_update,
  get_core_metadata,
  open_external_url,
} from "@/app/desktop-api";
import { useDesktopRuntime } from "@/app/runtime/desktop/use-desktop-runtime";
import {
  DesktopProgressToastModalLayer,
  useDesktopToast,
} from "@/app/runtime/toast/use-desktop-toast";
import "@/app/shell/app-shell.css";
import type { AppearanceMenuActionId, BottomActionId, RouteId } from "@/app/navigation/types";
import { LocaleProvider, useI18n } from "@/i18n";
import { SidebarInset, SidebarProvider } from "@/shadcn/sidebar";
import { Toaster } from "@/shadcn/sonner";
import { TooltipProvider } from "@/shadcn/tooltip";
import { AppSidebar } from "@/app/shell/app-sidebar";
import { AppTitlebar } from "@/app/shell/app-titlebar";
import { AppAlertDialog } from "@/widgets/app-alert-dialog/app-alert-dialog";

const SIDEBAR_STORAGE_KEY = "lg-sidebar-collapsed";
const THEME_STORAGE_KEY = "lg-theme-mode";
const FONT_FAMILY_STORAGE_KEY = "lg-base-font-mode";
const GITHUB_REPOSITORY_URL = "https://github.com/neavo/LinguaGacha";

type ThemeMode = "light" | "dark";

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

function resolve_toggled_app_language(app_language: "ZH" | "EN"): "ZH" | "EN" {
  if (app_language === "EN") {
    return "ZH";
  }

  return "EN";
}

function resolve_selectable_route(route_id: RouteId): RouteId {
  if (route_id === "text-replacement") {
    return "pre-translation-replacement";
  } else if (route_id === "custom-prompt") {
    return "translation-prompt";
  } else {
    return route_id;
  }
}

function has_registered_screen(route_id: RouteId): boolean {
  return SCREEN_REGISTRY[route_id] !== undefined;
}

function read_sidebar_state(): boolean {
  const stored_sidebar_state = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);

  if (stored_sidebar_state === "true") {
    return true;
  } else {
    return false;
  }
}

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

function AppContent(): JSX.Element {
  const {
    hydration_ready,
    pending_target_route,
    is_app_language_updating,
    project_snapshot,
    project_warmup_status,
    settings_snapshot,
    set_pending_target_route,
    update_app_language,
  } = useDesktopRuntime();
  const { push_persistent_toast, push_toast } = useDesktopToast();
  const { t } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const shell_info = window.desktopApp.shell;
  const [selected_route, set_selected_route] = useState<RouteId>(DEFAULT_ROUTE_ID);
  const [expanded_items, set_expanded_items] = useState<Set<RouteId>>(() => new Set());
  const [is_sidebar_collapsed, set_is_sidebar_collapsed] = useState<boolean>(() =>
    read_sidebar_state(),
  );
  const [is_lg_base_font_enabled, set_is_lg_base_font_enabled] = useState<boolean>(() =>
    read_lg_base_font_enabled(),
  );
  const [app_version, set_app_version] = useState<string | null>(null);
  const [update_release_url, set_update_release_url] = useState<string | null>(null);
  const [close_confirm_open, set_close_confirm_open] = useState<boolean>(false);
  const [close_confirm_submitting, set_close_confirm_submitting] = useState<boolean>(false);
  const previous_project_loaded_ref = useRef<boolean>(project_snapshot.loaded);
  const previous_project_path_ref = useRef<string>(project_snapshot.path);
  const previous_project_warmup_status_ref = useRef(project_warmup_status);
  const update_toast_shown_ref = useRef<boolean>(false);
  const active_screen = SCREEN_REGISTRY[selected_route] ?? SCREEN_REGISTRY[DEFAULT_ROUTE_ID]!;
  const ScreenComponent = active_screen.component;
  const app_title =
    app_version === null
      ? t("app.metadata.app_name")
      : `${t("app.metadata.app_name")} v${app_version}`;
  const theme_mode: ThemeMode =
    resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : read_theme_mode();

  useEffect(() => {
    window.desktopApp.setTitleBarTheme(theme_mode);
  }, [theme_mode]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(is_sidebar_collapsed));
  }, [is_sidebar_collapsed]);

  useEffect(() => {
    const font_mode = is_lg_base_font_enabled ? "enabled" : "disabled";

    document.documentElement.dataset.lgBaseFont = font_mode;
    window.localStorage.setItem(FONT_FAMILY_STORAGE_KEY, font_mode);
  }, [is_lg_base_font_enabled]);

  useEffect(() => {
    let is_disposed = false;

    void get_core_metadata()
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
        set_update_release_url(release_update.release_url);
      }
    });

    return () => {
      is_disposed = true;
    };
  }, [app_version]);

  useEffect(() => {
    if (update_release_url === null || update_toast_shown_ref.current) {
      return;
    }

    update_toast_shown_ref.current = true;
    push_persistent_toast("warning", t("app.update.toast"));
  }, [push_persistent_toast, t, update_release_url]);

  useEffect(() => {
    document.title = app_title;
  }, [app_title]);

  useEffect(() => {
    return window.desktopApp.onWindowCloseRequest(() => {
      set_close_confirm_open(true);
    });
  }, []);

  useEffect(() => {
    if (!hydration_ready) {
      return;
    }

    const was_loaded = previous_project_loaded_ref.current;
    const previous_project_path = previous_project_path_ref.current;
    const previous_project_warmup_status = previous_project_warmup_status_ref.current;
    previous_project_loaded_ref.current = project_snapshot.loaded;
    previous_project_path_ref.current = project_snapshot.path;
    previous_project_warmup_status_ref.current = project_warmup_status;

    if (was_loaded && !project_snapshot.loaded) {
      set_selected_route(DEFAULT_ROUTE_ID);
      set_pending_target_route(null);
      return;
    }

    if (!project_snapshot.loaded || project_warmup_status !== "ready") {
      return;
    }

    const project_just_loaded = !was_loaded;
    const project_path_changed = previous_project_path !== project_snapshot.path;
    const warmup_just_completed = previous_project_warmup_status !== "ready";

    if (project_just_loaded || project_path_changed || warmup_just_completed) {
      if (pending_target_route !== null) {
        set_selected_route(resolve_selectable_route(pending_target_route));
        set_pending_target_route(null);
      } else if (
        selected_route === DEFAULT_ROUTE_ID ||
        project_just_loaded ||
        project_path_changed ||
        warmup_just_completed
      ) {
        set_selected_route("workbench");
      }
    }
  }, [
    hydration_ready,
    pending_target_route,
    project_snapshot.loaded,
    project_snapshot.path,
    project_warmup_status,
    selected_route,
    set_pending_target_route,
  ]);

  const disabled_route_ids = useMemo<ReadonlySet<RouteId>>(() => {
    if (!project_snapshot.loaded) {
      return new Set(ROUTE_IDS_DISABLED_WHEN_PROJECT_UNLOADED);
    }

    if (project_warmup_status === "ready") {
      return new Set();
    }

    return new Set(PROJECT_DEPENDENT_ROUTE_IDS);
  }, [project_snapshot.loaded, project_warmup_status]);

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

  function handle_select_route(route_id: RouteId): void {
    const next_route = resolve_selectable_route(route_id);

    if (!project_snapshot.loaded && PROJECT_DEPENDENT_ROUTE_IDS.has(next_route)) {
      set_pending_target_route(next_route);
      set_selected_route(DEFAULT_ROUTE_ID);
      return;
    }

    if (
      project_snapshot.loaded &&
      project_warmup_status !== "ready" &&
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

  function handle_bottom_action(action_id: BottomActionId): void {
    if (action_id !== "language") {
      return;
    }

    void update_app_language(resolve_toggled_app_language(settings_snapshot.app_language)).catch(
      (error: unknown) => {
        if (error instanceof Error) {
          push_toast("error", error.message);
        } else {
          push_toast("error", t("app.feedback.update_failed"));
        }
      },
    );
  }

  function handle_appearance_menu_action(action_id: AppearanceMenuActionId): void {
    if (action_id === "theme-mode") {
      if (theme_mode === "light") {
        setTheme("dark");
      } else {
        setTheme("light");
      }
    } else {
      set_is_lg_base_font_enabled((previous_value) => {
        return !previous_value;
      });
    }
  }

  function handle_profile_action(): void {
    const target_url = update_release_url ?? GITHUB_REPOSITORY_URL;

    void open_external_url(target_url).catch((error: unknown) => {
      if (error instanceof Error) {
        push_toast("error", error.message);
      } else {
        push_toast("error", t("app.feedback.update_failed"));
      }
    });
  }

  async function handle_confirm_window_close(): Promise<void> {
    set_close_confirm_submitting(true);
    try {
      await window.desktopApp.quitApp();
    } catch (error) {
      set_close_confirm_submitting(false);
      if (error instanceof Error) {
        push_toast("error", error.message);
      } else {
        push_toast("error", t("app.feedback.update_failed"));
      }
    }
  }

  return (
    <>
      <SidebarProvider
        open={!is_sidebar_collapsed}
        onOpenChange={(is_open) => {
          // 统一由应用根持有折叠态，这样标题栏按钮和 sidebar 语义状态始终一致。
          set_is_sidebar_collapsed(!is_open);
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
          <AppTitlebar title={app_title} />
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
                <ProjectPagesProvider>
                  <QualityStatisticsProvider>
                    <ScreenComponent is_sidebar_collapsed={is_sidebar_collapsed} />
                  </QualityStatisticsProvider>
                </ProjectPagesProvider>
              </AppNavigationProvider>
            </SidebarInset>
          </section>
        </main>
      </SidebarProvider>

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

function App(): JSX.Element {
  return (
    <DesktopRuntimeProvider>
      <LocaleProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme={read_theme_mode()}
          enableSystem={false}
          storageKey={THEME_STORAGE_KEY}
          themes={["light", "dark"]}
        >
          <TooltipProvider delayDuration={120}>
            <AppContent />
            <DesktopProgressToastModalLayer />
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </LocaleProvider>
    </DesktopRuntimeProvider>
  );
}

export default App;
