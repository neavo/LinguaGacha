import { ChevronDown, ChevronUp, ListStart, Maximize2, Minimize2, ScrollText } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  open_log_stream,
  read_log_detail,
  type LogDetail,
  type LogEvent,
} from "@frontend/app/desktop/desktop-api";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import { useDebouncedValue } from "@frontend/widgets/interactions/use-debounce";
import { cn } from "@frontend/shadcn/classnames";
import {
  append_log_events,
  compress_log_message_text,
  filter_log_events,
  format_log_timestamp,
  sort_log_events_latest_first,
  type LogLevelFilter,
} from "@frontend/pages/log-window-page/logic";
import { LogAppendBuffer } from "@frontend/pages/log-window-page/log-append-buffer";
import { LogDetailView } from "@frontend/pages/log-window-page/log-detail-view";
import { AppButton } from "@frontend/widgets/app-button";
import { Card, CardContent } from "@frontend/shadcn/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  tooltip_trigger_target,
} from "@frontend/shadcn/tooltip";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { AppTable } from "@frontend/widgets/app-table/app-table";
import type {
  AppTableColumn,
  AppTableSelectionChange,
} from "@frontend/widgets/app-table/app-table-types";
import { SearchBar, type SearchBarScopeOption } from "@frontend/widgets/search-bar/search-bar";
import "@frontend/app/shell/app-titlebar.css";
import "@frontend/pages/log-window-page/log-window-page.css";

// 日志等级筛选顺序同时决定搜索范围菜单顺序。
const LEVEL_FILTERS: LogLevelFilter[] = ["all", "debug", "info", "warning", "error", "fatal"];
// 筛选值和日志等级共用同一份本地化键映射。
const LEVEL_LABEL_KEYS: Record<LogLevelFilter, LocaleKey> = {
  all: "log_window_page.level.all",
  debug: "log_window_page.level.debug",
  info: "log_window_page.level.info",
  warning: "log_window_page.level.warning",
  error: "log_window_page.level.error",
  fatal: "log_window_page.level.fatal",
};
// 详情区当前形态映射到下一次切换动作的标签。
const DETAIL_EXPAND_LABEL_KEYS: Record<"expanded" | "collapsed", LocaleKey> = {
  expanded: "log_window_page.detail.minimize" as LocaleKey,
  collapsed: "log_window_page.detail.maximize" as LocaleKey,
};

// 详情区状态绑定当前选中日志 ID，避免迟到请求覆盖下一条选中项
type LogDetailState =
  | { status: "idle"; event_id: null; detail: null }
  | { status: "loading" | "unavailable" | "failed"; event_id: string; detail: null }
  | { status: "ready"; event_id: string; detail: LogDetail };

// follow_latest 记录用户是否仍跟随列表头部，不能从新事件到达后的 active_row_id 反推。
type LogSelectionState = AppTableSelectionChange & {
  follow_latest: boolean;
};

/**
 * AppTable 会把 table_class_name 同时挂到表头、浮层和表体，从 viewport 内定位避免误取固定表头
 */
function scroll_log_table_to_top(): void {
  const table_element = document.querySelector<HTMLElement>(
    '[data-slot="scroll-area-viewport"] .log-window-page__table',
  );
  const viewport_element = table_element?.closest('[data-slot="scroll-area-viewport"]');
  if (viewport_element instanceof HTMLElement) {
    viewport_element.scrollTop = 0;
  }
}

/** 日志窗口只持有轻量事件，详情按选中项读取并在当前筛选结果内导航。 */
export function LogWindowPage(): JSX.Element {
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const shell_info = window.desktopApp.shell;
  const [events, set_events] = useState<LogEvent[]>([]);
  const [level_filter, set_level_filter] = useState<LogLevelFilter>("all");
  const [keyword, set_keyword] = useState<string>("");
  const debounced_keyword = useDebouncedValue(keyword); // 搜索框即时显示 keyword，日志过滤只消费延迟值
  const [is_regex, set_is_regex] = useState<boolean>(false);
  const [selection_state, set_selection_state] = useState<LogSelectionState>({
    selected_row_ids: [],
    active_row_id: null,
    anchor_row_id: null,
    follow_latest: true,
  });
  const [detail_expanded, set_detail_expanded] = useState<boolean>(false);
  const [detail_state, set_detail_state] = useState<LogDetailState>({
    status: "idle",
    event_id: null,
    detail: null,
  });

  useEffect(() => {
    document.title = t("log_window_page.title");
  }, [t]);

  useEffect(() => {
    const log_append_buffer = new LogAppendBuffer<LogEvent>({
      onFlush: (next_events) => {
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
          log_append_buffer.append(next_event.value);
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
      log_append_buffer.dispose();
      void iterator.return?.();
    };
  }, [push_toast, t]);

  const filtered_events = useMemo(() => {
    return filter_log_events({
      events,
      level_filter,
      keyword: debounced_keyword,
      is_regex,
    });
  }, [debounced_keyword, events, is_regex, level_filter]);
  const visible_events = useMemo(() => {
    return sort_log_events_latest_first(filtered_events);
  }, [filtered_events]);
  // 跟随、回顶和前后导航都以当前筛选结果为边界，不跳到不可见日志。
  const latest_event_id = visible_events[0]?.id ?? null;

  const invalid_filter_message = useMemo(() => {
    if (!is_regex || debounced_keyword.trim() === "") {
      return null;
    }

    try {
      new RegExp(debounced_keyword, "iu");
      return null;
    } catch {
      return t("log_window_page.search.regex_invalid");
    }
  }, [debounced_keyword, is_regex, t]);

  const level_filter_options = useMemo<SearchBarScopeOption<LogLevelFilter>[]>(() => {
    return LEVEL_FILTERS.map((level) => ({
      value: level,
      label: t(LEVEL_LABEL_KEYS[level]),
    }));
  }, [t]);

  const level_filter_label = t(LEVEL_LABEL_KEYS[level_filter]);
  const scope_tooltip = t("app.tooltip.value", {
    TITLE: t("log_window_page.search.scope.tooltip_label"),
    VALUE: level_filter_label,
  });
  const regex_state_label = t(is_regex ? "app.state.enabled" : "app.state.disabled");
  const regex_tooltip = t("app.tooltip.value", {
    TITLE: t("log_window_page.search.regex_tooltip_label"),
    VALUE: regex_state_label,
  });
  const detail_expand_label = t(
    DETAIL_EXPAND_LABEL_KEYS[detail_expanded ? "expanded" : "collapsed"],
  );

  const selected_event_index = useMemo(() => {
    return selection_state.active_row_id === null
      ? -1
      : visible_events.findIndex((event) => event.id === selection_state.active_row_id);
  }, [selection_state.active_row_id, visible_events]);
  const selected_event =
    selected_event_index < 0 ? null : (visible_events[selected_event_index] ?? null);
  const selected_event_id = selected_event?.id ?? null;
  const previous_event_id =
    selected_event_index > 0 ? (visible_events[selected_event_index - 1]?.id ?? null) : null;
  const next_event_id =
    selected_event_index >= 0 ? (visible_events[selected_event_index + 1]?.id ?? null) : null;

  const apply_log_selection = useCallback(
    (payload: AppTableSelectionChange): void => {
      // 清空或选中列表头部继续跟随；主动选中旧日志立即暂停。
      set_selection_state({
        ...payload,
        follow_latest: payload.active_row_id === null || payload.active_row_id === latest_event_id,
      });
    },
    [latest_event_id],
  );

  const select_event_id = useCallback(
    (event_id: string): void => {
      apply_log_selection({
        selected_row_ids: [event_id],
        active_row_id: event_id,
        anchor_row_id: event_id,
      });
    },
    [apply_log_selection],
  );

  // 详情区无论展开与否都支持方向键导航，但不抢占输入控件和组合键。
  useEffect(() => {
    function handle_log_navigation_keydown(event: KeyboardEvent): void {
      if (
        selected_event_id === null ||
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, select") !== null
      ) {
        return;
      }

      let target_event_id: string | null;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        target_event_id = previous_event_id;
      } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        target_event_id = next_event_id;
      } else {
        return;
      }

      event.preventDefault();
      if (target_event_id !== null) {
        select_event_id(target_event_id);
      }
    }

    window.addEventListener("keydown", handle_log_navigation_keydown);
    return () => {
      window.removeEventListener("keydown", handle_log_navigation_keydown);
    };
  }, [next_event_id, previous_event_id, select_event_id, selected_event_id]);

  // 详情正文按当前选中行懒加载，避免完整日志进入列表 state 和筛选排序热路径
  useEffect(() => {
    if (selected_event_id === null) {
      set_detail_state({ status: "idle", event_id: null, detail: null });
      return;
    }

    let disposed = false;
    set_detail_state({ status: "loading", event_id: selected_event_id, detail: null });

    void read_log_detail(selected_event_id)
      .then((detail) => {
        if (disposed) {
          return;
        }
        set_detail_state(
          detail === null
            ? { status: "unavailable", event_id: selected_event_id, detail: null }
            : { status: "ready", event_id: selected_event_id, detail },
        );
      })
      .catch(() => {
        if (!disposed) {
          set_detail_state({ status: "failed", event_id: selected_event_id, detail: null });
        }
      });

    return () => {
      disposed = true;
    };
  }, [selected_event_id]);

  // 筛选或容量裁剪移除活动行时清空选区，并恢复到跟随模式。
  useEffect(() => {
    if (selection_state.active_row_id === null) {
      return;
    }

    if (visible_events.some((event) => event.id === selection_state.active_row_id)) {
      return;
    }

    apply_log_selection({
      selected_row_ids: [],
      active_row_id: null,
      anchor_row_id: null,
    });
  }, [apply_log_selection, selection_state.active_row_id, visible_events]);

  // 新日志替换连续空行时列表长度不变，因此直接依赖最新 ID 而不是数组长度。
  useEffect(() => {
    if (!selection_state.follow_latest || latest_event_id === null) {
      return;
    }

    if (
      selection_state.active_row_id !== null &&
      selection_state.active_row_id !== latest_event_id
    ) {
      select_event_id(latest_event_id);
    }
    scroll_log_table_to_top();
  }, [
    latest_event_id,
    select_event_id,
    selection_state.active_row_id,
    selection_state.follow_latest,
  ]);

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
                {compress_log_message_text(payload.row.message_preview)}
              </span>
            </span>
          );
        },
      },
    ];
  }, [t]);

  /**
   * 详情区只显示当前选中项的完整正文或稳定状态文案
   */
  function render_detail(): JSX.Element {
    let fallback_value: string;
    if (detail_state.event_id !== selected_event_id) {
      fallback_value =
        selected_event_id === null
          ? t("log_window_page.detail.empty")
          : t("log_window_page.detail.loading");
    } else {
      switch (detail_state.status) {
        case "idle":
          fallback_value = t("log_window_page.detail.empty");
          break;
        case "loading":
          fallback_value = t("log_window_page.detail.loading");
          break;
        case "unavailable":
          fallback_value = t("log_window_page.detail.unavailable");
          break;
        case "failed":
          fallback_value = t("log_window_page.detail.failed");
          break;
        case "ready":
          return <LogDetailView detail={detail_state.detail} />;
      }
    }

    return (
      <AppEditor
        variant="viewer"
        class_name="log-window-page__detail-editor"
        value={fallback_value}
        aria_label={t("log_window_page.detail.title")}
        wrap_lines
      />
    );
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
              <strong>{t("log_window_page.title")}</strong>
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
            tooltip: scope_tooltip,
            options: level_filter_options,
            on_change: set_level_filter,
          }}
          regex={{
            value: is_regex,
            label: t("log_window_page.search.regex"),
            tooltip: regex_tooltip,
            on_change: set_is_regex,
          }}
          extra_actions={
            <div className="log-window-page__actions">
              <AppButton
                type="button"
                variant="ghost"
                size="toolbar"
                className="search-bar__action-trigger"
                disabled={latest_event_id === null}
                onClick={() => {
                  if (latest_event_id === null) {
                    return;
                  }
                  select_event_id(latest_event_id);
                  scroll_log_table_to_top();
                }}
              >
                <ListStart data-icon="inline-start" />
                {t("log_window_page.action.return_to_top")}
              </AppButton>
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
            <CardContent className="log-window-page__table-card-content">
              <AppTable
                rows={visible_events}
                columns={columns}
                selection_mode="single"
                selected_row_ids={selection_state.selected_row_ids}
                active_row_id={selection_state.active_row_id}
                anchor_row_id={selection_state.anchor_row_id}
                sort_state={null}
                drag_enabled={false}
                get_row_id={(event) => event.id}
                on_selection_change={apply_log_selection}
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
                    {tooltip_trigger_target(
                      <AppButton
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="log-window-page__detail-action"
                        aria-label={t("log_window_page.detail.previous")}
                        disabled={previous_event_id === null}
                        onClick={() => {
                          if (previous_event_id !== null) {
                            select_event_id(previous_event_id);
                          }
                        }}
                      >
                        <ChevronUp aria-hidden="true" />
                      </AppButton>,
                    )}
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={8}>
                    <p>{t("log_window_page.detail.previous")}</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {tooltip_trigger_target(
                      <AppButton
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="log-window-page__detail-action"
                        aria-label={t("log_window_page.detail.next")}
                        disabled={next_event_id === null}
                        onClick={() => {
                          if (next_event_id !== null) {
                            select_event_id(next_event_id);
                          }
                        }}
                      >
                        <ChevronDown aria-hidden="true" />
                      </AppButton>,
                    )}
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={8}>
                    <p>{t("log_window_page.detail.next")}</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AppButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="log-window-page__detail-action"
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
            {render_detail()}
          </aside>
        </section>
      </div>
    </main>
  );
}
