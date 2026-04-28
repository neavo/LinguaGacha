import { ListEnd, Maximize2, Minimize2, ScrollText } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { open_log_stream, type LogEvent } from "@/app/desktop-api";
import { LiveRefreshScheduler } from "@/app/runtime/live-refresh-scheduler";
import { useDesktopToast } from "@/app/runtime/toast/use-desktop-toast";
import { useI18n, type LocaleKey } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  append_log_events,
  compress_log_message_text,
  filter_log_events,
  format_log_timestamp,
  sort_log_events_latest_first,
  type LogLevelFilter,
} from "@/pages/log-window-page/logic";
import { AppButton } from "@/widgets/app-button/app-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shadcn/tooltip";
import { AppEditor } from "@/widgets/app-editor/app-editor";
import { AppTable } from "@/widgets/app-table/app-table";
import type { AppTableColumn, AppTableSelectionChange } from "@/widgets/app-table/app-table-types";
import { SearchBar, type SearchBarScopeOption } from "@/widgets/search-bar/search-bar";
import "@/app/shell/app-titlebar.css";
import "@/pages/log-window-page/log-window-page.css";

const LEVEL_FILTERS: LogLevelFilter[] = ["all", "debug", "info", "warning", "error", "fatal"];
const LEVEL_LABEL_KEYS: Record<LogLevelFilter, LocaleKey> = {
  all: "log_window_page.level.all",
  debug: "log_window_page.level.debug",
  info: "log_window_page.level.info",
  warning: "log_window_page.level.warning",
  error: "log_window_page.level.error",
  fatal: "log_window_page.level.fatal",
};
const DETAIL_EXPAND_LABEL_KEYS: Record<"expanded" | "collapsed", LocaleKey> = {
  expanded: "log_window_page.detail.minimize" as LocaleKey,
  collapsed: "log_window_page.detail.maximize" as LocaleKey,
};

function find_log_scroll_viewport(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '.log-window-page__table [data-slot="scroll-area-viewport"]',
  );
}

export function LogWindowPage(): JSX.Element {
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const { resolvedTheme } = useTheme();
  const shell_info = window.desktopApp.shell;
  const [events, set_events] = useState<LogEvent[]>([]);
  const [level_filter, set_level_filter] = useState<LogLevelFilter>("all");
  const [keyword, set_keyword] = useState<string>("");
  const [is_regex, set_is_regex] = useState<boolean>(false);
  const [auto_scroll, set_auto_scroll] = useState<boolean>(true);
  const [selected_row_ids, set_selected_row_ids] = useState<string[]>([]);
  const [active_row_id, set_active_row_id] = useState<string | null>(null);
  const [anchor_row_id, set_anchor_row_id] = useState<string | null>(null);
  const [detail_expanded, set_detail_expanded] = useState<boolean>(false);

  useEffect(() => {
    document.title = t("log_window_page.title");
  }, [t]);

  useEffect(() => {
    const theme_mode =
      resolvedTheme === "dark" ||
      (resolvedTheme !== "light" && document.documentElement.classList.contains("dark"))
        ? "dark"
        : "light";

    window.desktopApp.setTitleBarTheme(theme_mode);
  }, [resolvedTheme]);

  useEffect(() => {
    const scheduler = new LiveRefreshScheduler<"logs", LogEvent>({
      onFlush: (batches) => {
        const next_events = batches.get("logs") ?? [];
        if (next_events.length === 0) {
          return;
        }

        set_events((previous_events) => append_log_events(previous_events, next_events));
      },
    });
    let disposed = false;
    const iterator = open_log_stream()[Symbol.asyncIterator]();

    async function run_stream(): Promise<void> {
      try {
        while (!disposed) {
          const next_event = await iterator.next();
          if (next_event.done === true) {
            return;
          }
          if (disposed) {
            return;
          }
          scheduler.enqueue("logs", next_event.value);
        }
      } catch {
        if (!disposed) {
          push_toast("error", t("log_window_page.feedback.stream_failed"));
        }
      }
    }

    void run_stream();

    return () => {
      disposed = true;
      scheduler.dispose();
      void iterator.return?.();
    };
  }, [push_toast, t]);

  const filtered_events = useMemo(() => {
    return filter_log_events({
      events,
      level_filter,
      keyword,
      is_regex,
    });
  }, [events, is_regex, keyword, level_filter]);
  const visible_events = useMemo(() => {
    return sort_log_events_latest_first(filtered_events);
  }, [filtered_events]);

  const invalid_filter_message = useMemo(() => {
    if (!is_regex || keyword.trim() === "") {
      return null;
    }

    try {
      new RegExp(keyword, "iu");
      return null;
    } catch {
      return t("log_window_page.search.regex_invalid");
    }
  }, [is_regex, keyword, t]);

  const level_filter_options = useMemo<SearchBarScopeOption<LogLevelFilter>[]>(() => {
    return LEVEL_FILTERS.map((level) => ({
      value: level,
      label: t(LEVEL_LABEL_KEYS[level]),
    }));
  }, [t]);

  const level_filter_label = t(LEVEL_LABEL_KEYS[level_filter]);
  const scope_tooltip = t("log_window_page.search.scope.tooltip").replace(
    "{STATE}",
    level_filter_label,
  );
  const regex_state_label = t(is_regex ? "app.toggle.enabled" : "app.toggle.disabled");
  const regex_tooltip = t("log_window_page.search.regex_tooltip").replace(
    "{STATE}",
    regex_state_label,
  );
  const auto_scroll_state_label = t(auto_scroll ? "app.toggle.enabled" : "app.toggle.disabled");
  const auto_scroll_tooltip = `${t("log_window_page.action.autoscroll")} - ${auto_scroll_state_label}`;
  const detail_expand_label = t(
    DETAIL_EXPAND_LABEL_KEYS[detail_expanded ? "expanded" : "collapsed"],
  );

  const selected_event = useMemo(() => {
    if (active_row_id === null) {
      return null;
    }
    return visible_events.find((event) => event.id === active_row_id) ?? null;
  }, [active_row_id, visible_events]);

  useEffect(() => {
    if (active_row_id === null) {
      return;
    }

    if (visible_events.some((event) => event.id === active_row_id)) {
      return;
    }

    set_selected_row_ids([]);
    set_active_row_id(null);
    set_anchor_row_id(null);
  }, [active_row_id, visible_events]);

  useEffect(() => {
    if (!auto_scroll) {
      return;
    }

    const viewport = find_log_scroll_viewport();
    if (viewport !== null) {
      viewport.scrollTop = 0;
    }
  }, [auto_scroll, visible_events.length]);

  const columns = useMemo<AppTableColumn<LogEvent>[]>(() => {
    return [
      {
        kind: "data",
        id: "time",
        title: t("log_window_page.fields.time"),
        width: 150,
        align: "center",
        render_cell: (payload) => {
          return (
            <span className="log-window-page__table-muted">
              {format_log_timestamp(payload.row.created_at)}
            </span>
          );
        },
      },
      {
        kind: "data",
        id: "message",
        title: t("log_window_page.fields.message"),
        render_cell: (payload) => {
          return (
            <span className="log-window-page__message-cell">
              <span className="log-window-page__message-level" data-level={payload.row.level}>
                [{t(LEVEL_LABEL_KEYS[payload.row.level])}]
              </span>
              <span className="log-window-page__message-body">
                {compress_log_message_text(payload.row.message)}
              </span>
            </span>
          );
        },
      },
    ];
  }, [t]);

  function handle_selection_change(payload: AppTableSelectionChange): void {
    set_selected_row_ids(payload.selected_row_ids);
    set_active_row_id(payload.active_row_id);
    set_anchor_row_id(payload.anchor_row_id);
  }

  return (
    <main
      className="log-window-page"
      style={
        {
          "--titlebar-height": `${shell_info.titleBarHeight}px`,
          "--titlebar-safe-area-start": `${shell_info.titleBarSafeAreaStart}px`,
          "--titlebar-safe-area-end": `${shell_info.titleBarSafeAreaEnd}px`,
        } as CSSProperties
      }
    >
      <header
        className="titlebar shell-topbar log-window-page__titlebar"
        data-titlebar-control-side={shell_info.titleBarControlSide}
      >
        <div className="topbar__safe-area topbar__safe-area--start" aria-hidden="true" />
        <div className="topbar__content log-window-page__titlebar-content">
          <div className="topbar__left log-window-page__titlebar-left">
            <ScrollText size={16} aria-hidden="true" />
            <div className="topbar__brand">
              <strong>{t("log_window_page.window_title")}</strong>
            </div>
          </div>
        </div>
        <div className="topbar__safe-area topbar__safe-area--end" aria-hidden="true" />
      </header>

      <div className="log-window-page__body">
        <SearchBar
          variant="filter"
          className="log-window-page__search-bar"
          keyword={keyword}
          placeholder={t("log_window_page.search.placeholder")}
          clear_label={t("log_window_page.search.clear")}
          invalid_message={invalid_filter_message}
          on_keyword_change={set_keyword}
          scope={{
            value: level_filter,
            button_label:
              level_filter === "all" ? t("log_window_page.search.scope.label") : level_filter_label,
            aria_label: t("log_window_page.search.scope.label"),
            tooltip: scope_tooltip,
            options: level_filter_options,
            on_change: set_level_filter,
          }}
          regex={{
            value: is_regex,
            label: t("log_window_page.search.regex"),
            tooltip: regex_tooltip,
            enabled_label: t("app.toggle.enabled"),
            disabled_label: t("app.toggle.disabled"),
            on_change: set_is_regex,
          }}
          extra_actions={
            <div className="log-window-page__actions">
              <Tooltip>
                <TooltipTrigger asChild>
                  <AppButton
                    type="button"
                    variant="ghost"
                    size="toolbar"
                    className="search-bar__action-trigger"
                    data-active={auto_scroll ? "true" : undefined}
                    onClick={() => {
                      set_auto_scroll((previous_value) => !previous_value);
                    }}
                  >
                    <ListEnd data-icon="inline-start" />
                    {t("log_window_page.action.autoscroll")}
                  </AppButton>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={8}>
                  <p>{auto_scroll_tooltip}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          }
        />

        <section
          className={cn(
            "log-window-page__content",
            detail_expanded ? "log-window-page__content--detail-expanded" : undefined,
          )}
        >
          <Card variant="table" className="log-window-page__table-card">
            <CardHeader className="sr-only">
              <CardTitle>{t("log_window_page.title")}</CardTitle>
            </CardHeader>
            <CardContent className="log-window-page__table-card-content">
              <AppTable
                rows={visible_events}
                columns={columns}
                selection_mode="single"
                selected_row_ids={selected_row_ids}
                active_row_id={active_row_id}
                anchor_row_id={anchor_row_id}
                sort_state={null}
                drag_enabled={false}
                get_row_id={(event) => event.id}
                on_selection_change={handle_selection_change}
                on_sort_change={() => undefined}
                on_reorder={() => undefined}
                on_row_double_click={() => {
                  set_detail_expanded(true);
                }}
                box_selection_enabled={false}
                table_class_name="log-window-page__table"
                row_class_name={(payload) =>
                  cn(
                    "log-window-page__table-row",
                    `log-window-page__table-row--${payload.row.level}`,
                  )
                }
              />
            </CardContent>
          </Card>

          <aside className="log-window-page__detail" aria-label={t("log_window_page.detail.title")}>
            <div className="log-window-page__detail-head">
              <h2>{t("log_window_page.detail.title")}</h2>
              <div className="log-window-page__detail-head-actions">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AppButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="log-window-page__detail-resize"
                      aria-label={detail_expand_label}
                      onClick={() => {
                        set_detail_expanded((previous_value) => !previous_value);
                      }}
                    >
                      {detail_expanded ? (
                        <Minimize2 aria-hidden="true" />
                      ) : (
                        <Maximize2 aria-hidden="true" />
                      )}
                    </AppButton>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={8}>
                    <p>{detail_expand_label}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
            <AppEditor
              class_name="log-window-page__detail-editor"
              value={selected_event?.message ?? ""}
              aria_label={t("log_window_page.detail.title")}
              read_only
            />
          </aside>
        </section>
      </div>
    </main>
  );
}
