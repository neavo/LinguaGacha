import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOG_POLL_INTERVAL_MS, type LogPage } from "@shared/log";
import { useLogPages } from "./use-log-pages";

const mocks = vi.hoisted(() => ({
  page: vi.fn(),
  dates: vi.fn(),
  toast: vi.fn(),
  text: (key: string) => key,
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({
  read_log_page: mocks.page,
  read_log_dates: mocks.dates,
}));

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  useDesktopToast: () => ({ push_toast: mocks.toast }),
}));
vi.mock("@frontend/app/locale/locale-provider", () => ({ useI18n: () => ({ t: mocks.text }) }));

/** 构造单日期分页响应，保留前后游标约束。 */
function page(line: number, date = "20260913"): LogPage {
  return {
    status: "ready",
    entries: [
      {
        id: `${date}:${String(line)}`,
        date,
        line,
        revision: "rev",
        created_at: "2026-09-13T00:00:00Z",
        level: "info",
        source: "test",
        message_preview: String(line),
        message_length: 1,
      },
    ],
    before: { date, line: line - 1, revision: "rev" },
    after: { date, line, revision: "rev" },
    has_more: false,
  };
}

describe("useLogPages", () => {
  it("没有可选文件时不发分页请求，首次发现文件后才选择日期", async () => {
    await mount([]);
    expect(current.date).toBeNull();
    expect(current.loading).toBe(false);
    expect(mocks.page).not.toHaveBeenCalled();
    mocks.dates.mockResolvedValue(["20260913"]);
    await act(async () => {
      await current.refresh_dates();
    });
    expect(current.date).toBe("20260913");
    expect(mocks.page).toHaveBeenCalledExactlyOnceWith(
      { date: "20260913", direction: "latest" },
      expect.any(AbortSignal),
    );
  });

  it("旧日期历史请求取消后失败不会改变新日期跟随状态或显示 Toast", async () => {
    await mount();
    let reject_old: ((error: Error) => void) | undefined;
    mocks.page.mockImplementationOnce(
      () =>
        new Promise<LogPage>((_resolve, reject) => {
          reject_old = reject;
        }),
    );
    await act(async () => {
      current.load_older();
    });
    mocks.page.mockResolvedValue(page(7, "20260912"));
    await act(async () => {
      current.select_date("20260912");
    });
    await act(async () => {
      reject_old!(new Error("cancelled"));
    });
    expect(current.following).toBe(true);
    expect(current.entries[0]?.date).toBe("20260912");
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("首次选择最新实际日期，刷新目录和恢复可见都不自动跨日", async () => {
    await mount();
    expect(current.date).toBe("20260913");
    expect(mocks.page).toHaveBeenCalledWith(
      { date: "20260913", direction: "latest" },
      expect.any(AbortSignal),
    );
    mocks.dates.mockResolvedValue(["20260914", "20260913", "20260912"]);
    await act(async () => {
      await current.refresh_dates();
    });
    expect(current.date).toBe("20260913");
    expect(current.dates[0]).toBe("20260914");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.page.mock.calls.every(([request]) => request.date === "20260913")).toBe(true);
    mocks.page.mockResolvedValue(page(7, "20260912"));
    await act(async () => {
      current.select_date("20260912");
    });
    expect(current.entries.map((entry) => entry.date)).toEqual(["20260912"]);
    await act(async () => {
      current.refresh();
    });
    expect(mocks.page).toHaveBeenLastCalledWith(
      { date: "20260912", direction: "latest" },
      expect.any(AbortSignal),
    );
  });

  it("所选文件过期后保留日期供用户重新选择，目录刷新不隐式切换", async () => {
    await mount();
    mocks.dates.mockResolvedValue(["20260914"]);
    mocks.page.mockResolvedValue({
      status: "expired",
      entries: [],
      before: null,
      after: null,
      has_more: false,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOG_POLL_INTERVAL_MS);
    });
    expect(current.expired).toBe(true);
    expect(current.date).toBe("20260913");
    expect(current.dates).toEqual(["20260914"]);
    expect(current.entries).toEqual([]);
  });
  it("历史加载失败只提示 Toast，保留游标等待下一次滚动重试", async () => {
    await mount();
    mocks.page.mockRejectedValueOnce(new Error("read failed"));
    await act(async () => {
      current.load_older();
    });
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith("error", "log_window_page.history.failed");
    expect(current.entries.map((entry) => entry.line)).toEqual([10]);
    expect(current.failed).toBe(false);
    const calls = mocks.page.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOG_POLL_INTERVAL_MS * 2);
    });
    expect(
      mocks.page.mock.calls.slice(calls).every(([request]) => request.direction === "check"),
    ).toBe(true);
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    mocks.page.mockResolvedValueOnce(page(1));
    await act(async () => {
      current.load_older();
    });
    expect(mocks.page).toHaveBeenLastCalledWith(
      { date: "20260913", direction: "before", cursor: page(10).before },
      expect.any(AbortSignal),
    );
    expect(current.entries.map((entry) => entry.line)).toEqual([1, 10]);
  });

  it("滚动发生在增量查询期间时排队一次，历史读取期间的重复滚动不重复请求", async () => {
    await mount();
    let finish: ((result: LogPage) => void) | undefined;
    mocks.page.mockImplementationOnce(
      () =>
        new Promise<LogPage>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOG_POLL_INTERVAL_MS);
    });
    await act(async () => {
      current.load_older();
      current.load_older();
    });
    expect(mocks.page).toHaveBeenCalledTimes(2);
    let finish_older: ((result: LogPage) => void) | undefined;
    mocks.page.mockImplementationOnce(
      () =>
        new Promise<LogPage>((resolve) => {
          finish_older = resolve;
        }),
    );
    await act(async () => {
      finish!({ ...page(10), entries: [] });
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.page).toHaveBeenCalledTimes(3);
    expect(mocks.page.mock.calls.at(-1)![0].direction).toBe("before");
    await act(async () => {
      current.load_older();
      current.load_older();
    });
    expect(mocks.page).toHaveBeenCalledTimes(3);
    await act(async () => {
      finish_older!(page(1));
    });
    expect(current.entries.map((entry) => entry.line)).toEqual([1, 10]);
  });
  it("历史检查发现外部保存后清空旧页并更新重置标记，再读取新摘要", async () => {
    await mount();
    mocks.page.mockResolvedValueOnce(page(1));
    await act(async () => {
      current.load_older();
    });
    const updated = page(10);
    updated.entries[0]!.revision = "new";
    updated.entries[0]!.message_preview = "修改后的正文";
    updated.before!.revision = "new";
    updated.after!.revision = "new";
    mocks.page.mockResolvedValueOnce({
      status: "cursor_invalid",
      entries: [],
      before: null,
      after: null,
      has_more: false,
    });
    mocks.page.mockResolvedValue(updated);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOG_POLL_INTERVAL_MS + 1);
    });
    expect(current.reset_revision).toBe(1);
    expect(current.entries.map((entry) => entry.message_preview)).toEqual(["修改后的正文"]);
    expect(mocks.page.mock.calls.some(([request]) => request.direction === "check")).toBe(true);
  });
  let root: Root;
  let container: HTMLDivElement;
  let current: ReturnType<typeof useLogPages>;
  /** 将 Hook 的公开状态暴露给组件生命周期测试。 */
  function Probe() {
    current = useLogPages(null);
    return <div>{current.entries.map((entry) => entry.id).join(",")}</div>;
  }
  /** 挂载 Hook 并隔离计时器、可见性与 API 响应。 */
  async function mount(available_dates = ["20260913", "20260912"]): Promise<void> {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    mocks.dates.mockResolvedValue(available_dates);
    mocks.page.mockResolvedValue(page(10));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Probe />);
    });
  }
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("串行补读不重叠，隐藏暂停，恢复从已读游标继续", async () => {
    await mount();
    let finish: ((result: LogPage) => void) | undefined;
    mocks.page.mockImplementationOnce(
      () =>
        new Promise<LogPage>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOG_POLL_INTERVAL_MS);
    });
    expect(mocks.page).toHaveBeenLastCalledWith(
      { date: "20260913", direction: "after", cursor: page(10).after },
      expect.any(AbortSignal),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOG_POLL_INTERVAL_MS * 4);
    });
    expect(mocks.page).toHaveBeenCalledTimes(2);
    await act(async () => {
      finish!(page(20));
    });
    expect(current.entries.map((entry) => entry.line)).toEqual([10, 20]);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(LOG_POLL_INTERVAL_MS * 4);
    });
    expect(mocks.page).toHaveBeenCalledTimes(2);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    mocks.page.mockResolvedValue({ ...page(20), entries: [] });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.page).toHaveBeenLastCalledWith(
      { date: "20260913", direction: "after", cursor: page(20).after },
      expect.any(AbortSignal),
    );
  });

  it("读取失败保留游标，历史向前加载后由刷新恢复跟随", async () => {
    await mount();
    mocks.page.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOG_POLL_INTERVAL_MS);
    });
    expect(current.failed).toBe(true);
    expect(current.entries).toHaveLength(1);
    mocks.page.mockResolvedValueOnce(page(1));
    await act(async () => {
      current.load_older();
    });
    expect(mocks.page).toHaveBeenLastCalledWith(
      { date: "20260913", direction: "before", cursor: page(10).before },
      expect.any(AbortSignal),
    );
    expect(current.entries.map((entry) => entry.line)).toEqual([1, 10]);
    const calls = mocks.page.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOG_POLL_INTERVAL_MS * 2);
    });
    expect(mocks.page).toHaveBeenCalledTimes(calls + 2);
    expect(
      mocks.page.mock.calls.slice(calls).every(([request]) => request.direction === "check"),
    ).toBe(true);
    expect(current.entries.map((entry) => entry.line)).toEqual([1, 10]);
    await act(async () => {
      current.refresh();
    });
    expect(mocks.page).toHaveBeenLastCalledWith(
      { date: "20260913", direction: "latest" },
      expect.any(AbortSignal),
    );
  });

  it("切换日期取消旧请求，忽略迟到结果，卸载取消新请求", async () => {
    await mount();
    let finish: ((result: LogPage) => void) | undefined;
    mocks.page.mockImplementationOnce(
      () =>
        new Promise<LogPage>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOG_POLL_INTERVAL_MS);
    });
    const old_signal = mocks.page.mock.calls.at(-1)![1] as AbortSignal;
    mocks.page.mockResolvedValue(page(30, "20260912"));
    await act(async () => {
      current.select_date("20260912");
    });
    expect(old_signal.aborted).toBe(true);
    await act(async () => {
      finish!(page(999));
    });
    expect(current.entries.map((entry) => entry.date)).toEqual(["20260912"]);
    const signal = mocks.page.mock.calls.at(-1)![1] as AbortSignal;
    act(() => root.unmount());
    expect(signal.aborted).toBe(true);
  });
});
