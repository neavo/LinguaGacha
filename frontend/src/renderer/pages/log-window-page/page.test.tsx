import type { ReactNode } from "react";
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LogEvent } from "@/app/desktop-api";
import { LogWindowPage } from "@/pages/log-window-page/page";

type StreamController = {
  closed: boolean;
  emit: (event: LogEvent) => void;
  iterator: AsyncIterator<LogEvent>;
};

const { open_log_stream_mock, push_toast_mock, stream_controllers } = vi.hoisted(() => {
  const controllers: StreamController[] = [];

  function create_controller(): StreamController {
    const event_queue: LogEvent[] = [];
    let pending_resolve: ((result: IteratorResult<LogEvent>) => void) | null = null;
    const controller: StreamController = {
      closed: false,
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
    stream_controllers: controllers,
  };
});

vi.mock("@/app/desktop-api", async () => {
  const actual = await vi.importActual<typeof import("@/app/desktop-api")>("@/app/desktop-api");
  return {
    ...actual,
    open_log_stream: open_log_stream_mock,
  };
});

vi.mock("@/app/runtime/toast/use-desktop-toast", () => {
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

vi.mock("@/i18n", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@/widgets/app-button/app-button", () => {
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

vi.mock("@/shadcn/input", () => {
  return {
    Input: (props: {
      onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
      placeholder?: string;
      value?: string;
    }) => <input value={props.value} placeholder={props.placeholder} onChange={props.onChange} />,
  };
});

vi.mock("@/shadcn/select", () => {
  return {
    Select: (props: { children: ReactNode }) => <div>{props.children}</div>,
    SelectContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    SelectItem: (props: { children: ReactNode; value: string }) => (
      <div data-value={props.value}>{props.children}</div>
    ),
    SelectTrigger: (props: { children: ReactNode }) => (
      <button type="button">{props.children}</button>
    ),
    SelectValue: () => <span />,
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
      on_row_double_click?: (payload: { row: LogEvent; row_id: string; row_index: number }) => void;
    }) => (
      <div>
        {props.rows.map((event, index) => {
          const row_id = props.get_row_id(event, index);
          return (
            <div
              key={row_id}
              data-log-row-id={row_id}
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

function build_log_event(message: string, overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    id: "log-1",
    sequence: 1,
    created_at: "2026-04-26T00:00:00.000+00:00",
    level: "info",
    message,
    ...overrides,
  };
}

function get_active_stream(): StreamController {
  const active_stream = stream_controllers.findLast((controller) => !controller.closed);
  if (active_stream === undefined) {
    throw new Error("没有活动日志流。");
  }
  return active_stream;
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
    push_toast_mock.mockReset();
    stream_controllers.splice(0, stream_controllers.length);
    vi.useRealTimers();
  });

  async function mount_page(): Promise<void> {
    vi.useFakeTimers();
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      writable: true,
      value: {
        shell: {
          titleBarHeight: 40,
          titleBarSafeAreaStart: 0,
          titleBarSafeAreaEnd: 144,
          titleBarControlSide: "right",
        },
        setTitleBarTheme: vi.fn(),
      },
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
      vi.advanceTimersByTime(250);
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
      vi.advanceTimersByTime(250);
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
      vi.advanceTimersByTime(250);
    });

    expect(container?.textContent).toContain("[log_window_page.level.warning]");
    expect(container?.textContent).toContain("警告正文");
    expect(container?.querySelector('[data-level="warning"]')).not.toBeNull();
  });

  it("双击日志行会放大详情区", async () => {
    await mount_page();

    await act(async () => {
      get_active_stream().emit(build_log_event("可放大日志"));
      await Promise.resolve();
      vi.advanceTimersByTime(250);
    });

    expect(container?.querySelector(".log-window-page__content--detail-expanded")).toBeNull();

    const row = container?.querySelector('[data-log-row-id="log-1"]');

    await act(async () => {
      row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(container?.querySelector(".log-window-page__content--detail-expanded")).not.toBeNull();
  });
});
