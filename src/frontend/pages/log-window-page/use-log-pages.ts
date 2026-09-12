import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { useCallback, useEffect, useRef, useState } from "react";
import { read_log_dates, read_log_page } from "@frontend/app/desktop/desktop-api";
import {
  LOG_POLL_INTERVAL_MS,
  LOG_PAGE_SIZE,
  LOG_WINDOW_ENTRY_CAPACITY,
  type LogEntry,
  type LogPage,
  type LogPageRequest,
} from "@shared/log";

type PageState = {
  date: string | null; // 缓存所属文件，切换日期的首帧不会显示旧页
  entries: LogEntry[];
  loading: boolean;
  failed: boolean;
  expired: boolean;
  can_load_older: boolean;
  reset_revision: number;
};

/** 页面是唯一轮询拥有者；按整页释放缓存，游标始终对应实际保留的页边界。 */
export function useLogPages(selectedId: string | null) {
  const { push_toast } = useDesktopToast();
  const { t } = useI18n();
  const [date, set_date] = useState<string | null>(null);
  const [dates, set_dates] = useState<string[]>([]);
  const [dates_loading, set_dates_loading] = useState(true);
  const [dates_failed, set_dates_failed] = useState(false);
  const [following, set_following] = useState(true);
  const date_request = useRef<AbortController | null>(null); // 目录刷新独立取消，不打断当前文件查询
  /** 取消旧目录请求，仅首次取得日期时设置默认选择。 */
  const refresh_dates = useCallback(async (): Promise<void> => {
    date_request.current?.abort();
    const controller = new AbortController();
    date_request.current = controller;
    set_dates_loading(true);
    try {
      const available = await read_log_dates(controller.signal);
      if (controller.signal.aborted) return;
      set_dates(available);
      // 只为尚未选择过日期的窗口设置默认值，新日期出现时保留原选择。
      set_date((previous) => previous ?? available[0] ?? null);
      set_dates_failed(false);
    } catch {
      if (!controller.signal.aborted) set_dates_failed(true);
    } finally {
      if (!controller.signal.aborted) set_dates_loading(false);
    }
  }, []);

  useEffect(() => {
    void refresh_dates();
    /** 窗口恢复可见时刷新目录，不改变用户已选日期。 */
    const on_visible = (): void => {
      if (document.visibilityState !== "hidden") void refresh_dates();
    };
    document.addEventListener("visibilitychange", on_visible);
    return () => {
      date_request.current?.abort();
      document.removeEventListener("visibilitychange", on_visible);
    };
  }, [refresh_dates]);

  const [revision, set_revision] = useState(0);
  const [state, set_state] = useState<PageState>({
    date: null,
    entries: [],
    loading: true,
    failed: false,
    expired: false,
    can_load_older: false,
    reset_revision: 0,
  });
  const selection = useRef({ following, selectedId }); // 轮询读取最新 UI 意图，避免重建请求任务
  const load_older_ref = useRef<(() => void) | null>(null); // 稳定 UI 回调接入当前日期队列

  useEffect(() => {
    selection.current = { following, selectedId };
  }, [following, selectedId]);

  useEffect(() => {
    if (date === null) return;
    const request_date = date;
    const controller = new AbortController();
    let pages: LogPage[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false; // 当前日期只允许一个读取请求在途
    let older = false; // 滚动请求可在状态检查期间排队
    let older_loading = false; // 历史读取或队列已占位时合并重复滚动
    let expired = false;
    let reset_revision = 0; // 文件失效通知页面清空选择与详情
    let entries: LogEntry[] = [];

    /** 只在页集合变化时更新摘要数组，空轮询保留引用。 */
    function publish(loading: boolean, failed = false, changed = true): void {
      if (changed) entries = pages.flatMap((page) => page.entries);
      set_state({
        entries,
        date,
        loading,
        failed,
        expired,
        reset_revision,
        can_load_older: (pages[0]?.before?.line ?? 0) > 0,
      });
    }

    /** 按整页释放远端缓存，保留选中页和有效游标。 */
    function trim(direction: "before" | "after"): void {
      while (
        pages.length > 1 &&
        pages.reduce((count, page) => count + page.entries.length, 0) > LOG_WINDOW_ENTRY_CAPACITY
      ) {
        const candidate = direction === "before" ? pages.at(-1)! : pages[0]!;
        if (candidate.entries.some((entry) => entry.id === selection.current.selectedId)) break;
        if (direction === "before") pages.pop();
        else pages.shift();
      }
    }

    /** 串行处理补读、历史分页与状态检查，迟到响应不得写回。 */
    async function read(): Promise<void> {
      if (controller.signal.aborted || busy || document.visibilityState === "hidden") return;
      clearTimeout(timer);
      busy = true;
      let delay = LOG_POLL_INTERVAL_MS;
      let direction: LogPageRequest["direction"] = "latest";
      try {
        const before = pages[0]?.before;
        const after = pages.at(-1)?.after;
        direction =
          older && before !== null && before !== undefined
            ? "before"
            : after === null || after === undefined
              ? "latest"
              : "after";
        older = false;
        if (pages.length > 0 && direction === "after" && !selection.current.following)
          direction = "check";
        older_loading = direction === "before";
        if (direction !== "after" && direction !== "check") publish(true, false, false);
        const page = await read_log_page(
          {
            date: request_date,
            direction,
            ...(direction === "before"
              ? { cursor: before! }
              : direction === "after" || direction === "check"
                ? { cursor: after! }
                : {}),
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (page.status === "expired") {
          expired = true;
          reset_revision += 1;
          pages = [];
          set_following(false);
          void refresh_dates();
        } else if (page.status === "cursor_invalid") {
          reset_revision += 1;
          pages = [];
          set_following(true);
          delay = 0;
        } else if (direction === "check") {
          // 历史浏览只检查文件状态，正常追加不改变已加载页。
        } else if (direction === "latest") {
          pages = [page];
        } else if (direction === "before") {
          if (page.entries.length > 0) pages.unshift(page);
          else if (pages[0] !== undefined) pages[0] = { ...pages[0], before: page.before };
          trim("before");
        } else {
          if (page.entries.length > 0) pages.push(page);
          else if (pages.at(-1) !== undefined)
            pages[pages.length - 1] = { ...pages.at(-1)!, after: page.after };
          trim("after");
          if (page.has_more) delay = 0;
        }
        if (
          direction !== "after" &&
          direction !== "check" &&
          page.entries.length === 0 &&
          page.has_more
        ) {
          older = true;
          delay = 0;
        }
        older_loading = older;
        publish(
          older && page.entries.length === 0,
          false,
          (direction !== "after" && direction !== "check") ||
            page.entries.length > 0 ||
            page.status !== "ready",
        );
      } catch {
        if (controller.signal.aborted) return;
        older_loading = false;
        if (direction === "before") {
          older = false;
          push_toast("error", t("log_window_page.history.failed"));
          set_following(false);
        }
        publish(false, direction !== "before", false);
      } finally {
        busy = false;
        if (!controller.signal.aborted && !expired)
          timer = setTimeout(
            () => {
              void read();
            },
            older ? 0 : delay,
          );
      }
    }

    load_older_ref.current = () => {
      if (older_loading || expired || (pages[0]?.before?.line ?? 0) === 0) return;
      set_following(false);
      older = true;
      void read();
    };
    /** 隐藏时停止调度，恢复后从现有游标继续读取。 */
    function visibility(): void {
      clearTimeout(timer);
      if (document.visibilityState !== "hidden") void read();
    }
    document.addEventListener("visibilitychange", visibility);
    publish(true);
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
      load_older_ref.current = null;
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [date, revision, push_toast, t, refresh_dates]);

  /** 稳定回调转交当前日期的历史读取队列。 */
  const load_older = useCallback(() => load_older_ref.current?.(), []);
  /** 重读所选日期末尾并恢复跟随，目录刷新仍保留选择。 */
  const refresh = useCallback(() => {
    set_following(true);
    set_revision((value) => value + 1);
    void refresh_dates();
  }, [refresh_dates]);
  /** 显式日期选择重置跟随，由生命周期切换取消旧请求。 */
  const select_date = useCallback(
    (next_date: string) => {
      if (next_date === date) return;
      set_following(true);
      set_date(next_date);
    },
    [date],
  );
  const current =
    state.date === date
      ? state
      : {
          ...state,
          entries: [],
          loading: true,
          failed: false,
          expired: false,
          can_load_older: false,
        };
  // 选中页位于缓存另一端时暂停继续扩展，移动选择后即可继续向前翻页。
  const selected_index = current.entries.findIndex((entry) => entry.id === selectedId);
  const can_load_older =
    current.can_load_older &&
    !(
      current.entries.length > LOG_WINDOW_ENTRY_CAPACITY - LOG_PAGE_SIZE &&
      selected_index >= current.entries.length - LOG_PAGE_SIZE
    );
  return {
    ...current,
    date,
    dates,
    following,
    set_following,
    select_date,
    refresh_dates,
    can_load_older,
    load_older,
    refresh,
    loading: date === null ? dates_loading : current.loading,
    failed: current.failed || dates_failed,
  };
}
