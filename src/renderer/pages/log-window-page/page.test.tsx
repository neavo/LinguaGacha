import type { ReactNode } from "react";
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LogEvent } from "@/app/desktop/desktop-api";
import { INPUT_QUERY_DEBOUNCE_MS } from "@/hooks/use-debounce";
import { LogWindowPage } from "@/pages/log-window-page/page";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

type StreamController = {
  closed: boolean;
  emit: (event: LogEvent) => void;
  iterator: AsyncIterator<LogEvent>;
};

const { open_log_stream_mock, push_toast_mock, read_log_detail_mock, stream_controllers } =
  vi.hoisted(() => {
    const controllers: StreamController[] = [];

    /**
     * 构造当前测试场景的标准数据。
     */
    function create_controller(): StreamController {
      const event_queue: LogEvent[] = [];
      let pending_resolve: ((result: IteratorResult<LogEvent>) => void) | null = null;
      const controller: StreamController = {
        closed: false,
        /**
         * 模拟事件订阅与派发行为。
         */
        emit(event: LogEvent): void {
          if (controller.closed) {
            return;
          }
          if (pending_resolve !== null) {
            const resolve = pending_resolve;
            pending_resolve = null;
            resolve({ done: false, value: event });
            return;
          }
          event_queue.push(event);
        },
        iterator: {
          /**
           * 支撑当前测试场景的专用辅助逻辑。
           */
          next(): Promise<IteratorResult<LogEvent>> {
            if (controller.closed) {
              return Promise.resolve({ done: true, value: undefined });
            }
            const event = event_queue.shift();
            if (event !== undefined) {
              return Promise.resolve({ done: false, value: event });
            }
            return new Promise<IteratorResult<LogEvent>>((resolve) => {
              pending_resolve = resolve;
            });
          },
          /**
           * 支撑当前测试场景的专用辅助逻辑。
           */
          return(): Promise<IteratorResult<LogEvent>> {
            controller.closed = true;
            if (pending_resolve !== null) {
              const resolve = pending_resolve;
              pending_resolve = null;
              resolve({ done: true, value: undefined });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
        },
      };

      return controller;
    }

    return {
      open_log_stream_mock: vi.fn(() => {
        const controller = create_controller();
        controllers.push(controller);
        return {
          [Symbol.asyncIterator]: () => controller.iterator,
        };
      }),
      push_toast_mock: vi.fn(),
      read_log_detail_mock: vi.fn(async (id: string) => ({
        id,
        sequence: Number(id.replace(/^log-/u, "")) || 1,
        created_at: "2026-04-26T00:00:00.000+00:00",
        level: "info",
        source: "test",
        message: `完整详情：${id}`,
      })),
      stream_controllers: controllers,
    };
  });

vi.mock("@/app/desktop/desktop-api", async () => {
  const actual = await vi.importActual<typeof import("@/app/desktop/desktop-api")>(
    "@/app/desktop/desktop-api",
  );
  return {
    ...actual,
    open_log_stream: open_log_stream_mock,
    read_log_detail: read_log_detail_mock,
  };
});

vi.mock("@/app/ui-runtime/use-desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
    }),
  };
});

vi.mock("next-themes", () => {
  return {
    useTheme: () => ({
      resolvedTheme: "dark",
    }),
  };
});

vi.mock("@/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@/widgets/app-button", () => {
  return {
    AppButton: (props: {
      children: ReactNode;
      disabled?: boolean;
      onClick?: () => void;
      type?: "button";
      "aria-label"?: string;
    }) => (
      <button
        type={props.type ?? "button"}
        aria-label={props["aria-label"]}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    ),
  };
});

vi.mock("@/shadcn/card", () => {
  return {
    Card: (props: { children: ReactNode }) => <section>{props.children}</section>,
    CardContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    CardHeader: (props: { children: ReactNode }) => <div>{props.children}</div>,
    CardTitle: (props: { children: ReactNode }) => <h2>{props.children}</h2>,
  };
});

vi.mock("@/shadcn/tooltip", () => {
  return {
    Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
    TooltipContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    TooltipTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  };
});

vi.mock("@/widgets/search-bar/search-bar", () => {
  return {
    SearchBar: (props: {
      keyword: string;
      placeholder: string;
      on_keyword_change: (next_keyword: string) => void;
      extra_actions?: ReactNode;
    }) => (
      <section>
        <input
          value={props.keyword}
          placeholder={props.placeholder}
          onChange={(event) => {
            props.on_keyword_change(event.target.value);
          }}
        />
        {props.extra_actions}
      </section>
    ),
  };
});

vi.mock("@/widgets/app-editor/app-editor", () => {
  return {
    AppEditor: (props: { value: string }) => <pre>{props.value}</pre>,
  };
});

vi.mock("@/widgets/app-table/app-table", () => {
  return {
    AppTable: (props: {
      rows: LogEvent[];
      columns: Array<{
        id: string;
        render_cell: (payload: {
          row: LogEvent;
          row_id: string;
          row_index: number;
          active: boolean;
          selected: boolean;
          dragging: boolean;
          can_drag: boolean;
          presentation: "body";
        }) => ReactNode;
      }>;
      get_row_id: (row: LogEvent, index: number) => string;
      on_selection_change?: (payload: {
        selected_row_ids: string[];
        active_row_id: string | null;
        anchor_row_id: string | null;
      }) => void;
      on_row_double_click?: (payload: { row: LogEvent; row_id: string; row_index: number }) => void;
    }) => (
      <div>
        {props.rows.map((event, index) => {
          const row_id = props.get_row_id(event, index);
          return (
            <div
              key={row_id}
              data-log-row-id={row_id}
              onClick={() => {
                props.on_selection_change?.({
                  selected_row_ids: [row_id],
                  active_row_id: row_id,
                  anchor_row_id: row_id,
                });
              }}
              onDoubleClick={() => {
                props.on_row_double_click?.({ row: event, row_id, row_index: index });
              }}
            >
              {props.columns.map((column) => (
                <span key={column.id}>
                  {column.render_cell({
                    row: event,
                    row_id,
                    row_index: index,
                    active: false,
                    selected: false,
                    dragging: false,
                    can_drag: false,
                    presentation: "body",
                  })}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    ),
  };
});

/**
 * 构建当前场景的稳定结果。
 */
function build_log_event(message: string, overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    id: "log-1",
    sequence: 1,
    created_at: "2026-04-26T00:00:00.000+00:00",
    level: "info",
    source: "test",
    message_preview: message,
    message_length: message.length,
    ...overrides,
  };
}

/**
 * 获取当前测试场景的公开值。
 */
function get_active_stream(): StreamController {
  const active_stream = stream_controllers.findLast((controller) => !controller.closed);
  if (active_stream === undefined) {
    throw new Error("没有活动日志流。");
  }
  return active_stream;
}

/**
 * 派发当前测试场景的输入变化。
 */
function change_input_value(input: HTMLInputElement, value: string): void {
  const value_descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  value_descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("LogWindowPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
    open_log_stream_mock.mockClear();
    read_log_detail_mock.mockClear();
    push_toast_mock.mockReset();
    stream_controllers.splice(0, stream_controllers.length);
    vi.useRealTimers();
  });

  /**
   * 挂载当前测试组件并等待渲染完成。
   */
  async function mount_page(): Promise<void> {
    vi.useFakeTimers();
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      writable: true,
      value: create_desktop_bridge_api_mock({
        methods: {
          setTitleBarTheme: vi.fn(),
        },
      }),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <StrictMode>
          <LogWindowPage />
        </StrictMode>,
      );
    });
  }

  it("在 StrictMode 重新挂载 effect 后仍会接收日志事件", async () => {
    await mount_page();

    await act(async () => {
      get_active_stream().emit(build_log_event("严格模式日志"));
      await Promise.resolve();
      vi.advanceTimersByTime(500);
    });

    expect(container?.textContent).toContain("严格模式日志");
    expect(open_log_stream_mock).toHaveBeenCalled();
  });

  it("按最新日志在前的顺序显示日志", async () => {
    await mount_page();

    await act(async () => {
      get_active_stream().emit(build_log_event("较早日志", { id: "log-1", sequence: 1 }));
      get_active_stream().emit(build_log_event("较新日志", { id: "log-2", sequence: 2 }));
      await Promise.resolve();
      vi.advanceTimersByTime(500);
    });

    const page_text = container?.textContent ?? "";
    expect(page_text.indexOf("较新日志")).toBeLessThan(page_text.indexOf("较早日志"));
  });

  it("在消息列内显示带颜色挂钩的级别前缀", async () => {
    await mount_page();

    await act(async () => {
      get_active_stream().emit(
        build_log_event("警告正文", {
          id: "log-warning",
          level: "warning",
        }),
      );
      await Promise.resolve();
      vi.advanceTimersByTime(500);
    });

    expect(container?.textContent).toContain("[log_window_page.level.warning]");
    expect(container?.textContent).toContain("警告正文");
    expect(container?.querySelector('[data-level="warning"]')).not.toBeNull();
  });

  it("搜索输入即时显示，日志列表在 250ms 后刷新", async () => {
    await mount_page();

    await act(async () => {
      get_active_stream().emit(build_log_event("alpha ready", { id: "log-alpha", sequence: 1 }));
      get_active_stream().emit(build_log_event("beta ready", { id: "log-beta", sequence: 2 }));
      await Promise.resolve();
      vi.advanceTimersByTime(500);
    });

    const input = container?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("日志搜索输入框未挂载。");
    }

    await act(async () => {
      change_input_value(input, "alpha");
    });

    expect(input.value).toBe("alpha");
    expect(container?.textContent).toContain("beta ready");

    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS - 1);
    });
    expect(container?.textContent).toContain("beta ready");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(container?.textContent).toContain("alpha ready");
    expect(container?.textContent).not.toContain("beta ready");
  });

  it("双击日志行会放大详情区", async () => {
    await mount_page();

    await act(async () => {
      get_active_stream().emit(build_log_event("可放大日志"));
      await Promise.resolve();
      vi.advanceTimersByTime(500);
    });

    expect(container?.querySelector(".log-window-page__content--detail-expanded")).toBeNull();

    const row = container?.querySelector('[data-log-row-id="log-1"]');

    await act(async () => {
      row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(container?.querySelector(".log-window-page__content--detail-expanded")).not.toBeNull();
  });

  it("选中日志行后按需读取完整详情", async () => {
    await mount_page();

    await act(async () => {
      get_active_stream().emit(build_log_event("列表预览", { id: "log-9", sequence: 9 }));
      await Promise.resolve();
      vi.advanceTimersByTime(500);
    });

    const row = container?.querySelector('[data-log-row-id="log-9"]');
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(read_log_detail_mock).toHaveBeenCalledWith("log-9");
    expect(container?.textContent).toContain("完整详情：log-9");
  });

  it("切换选中日志时不展示上一条详情", async () => {
    read_log_detail_mock.mockImplementation((id: string) => {
      if (id === "log-2") {
        return new Promise(() => {});
      }
      return Promise.resolve({
        id,
        sequence: 1,
        created_at: "2026-04-26T00:00:00.000+00:00",
        level: "info",
        source: "test",
        message: `完整详情：${id}`,
      });
    });
    await mount_page();

    await act(async () => {
      get_active_stream().emit(build_log_event("第一条", { id: "log-1", sequence: 1 }));
      get_active_stream().emit(build_log_event("第二条", { id: "log-2", sequence: 2 }));
      await Promise.resolve();
      vi.advanceTimersByTime(500);
    });

    const first_row = container?.querySelector('[data-log-row-id="log-1"]');
    await act(async () => {
      first_row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container?.textContent).toContain("完整详情：log-1");

    const second_row = container?.querySelector('[data-log-row-id="log-2"]');
    await act(async () => {
      second_row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container?.textContent).not.toContain("完整详情：log-1");
    expect(container?.textContent).toContain("log_window_page.detail.loading");
  });
});
