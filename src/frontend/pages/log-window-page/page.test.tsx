import type { ReactNode } from "react";
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LogEvent } from "@frontend/app/desktop/desktop-api";
import { LogWindowPage } from "@frontend/pages/log-window-page/page";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

type StreamController = {
  closed: boolean;
  emit: (event: LogEvent) => void;
  iterator: AsyncIterator<LogEvent>;
};

const { open_log_stream_mock, push_toast_mock, read_log_detail_mock, stream_controllers } =
  vi.hoisted(() => {
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
      read_log_detail_mock: vi.fn(async (id: string) => ({
        id,
        sequence: Number(id.replace(/^log-/u, "")) || 1,
        created_at: "2026-04-26T00:00:00.000+00:00",
        level: "info",
        source: "test",
        content: { kind: "text", text: `完整详情：${id}` },
      })),
      stream_controllers: controllers,
    };
  });

vi.mock("@frontend/app/desktop/desktop-api", async () => {
  const actual = await vi.importActual<typeof import("@frontend/app/desktop/desktop-api")>(
    "@frontend/app/desktop/desktop-api",
  );
  return {
    ...actual,
    open_log_stream: open_log_stream_mock,
    read_log_detail: read_log_detail_mock,
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
    }),
  };
});

vi.mock("@frontend/app/appearance/appearance-provider", () => {
  return {
    useAppearance: () => ({
      resolved_theme: "dark",
    }),
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@frontend/widgets/app-button", () => {
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

vi.mock("@frontend/shadcn/card", () => {
  return {
    Card: (props: { children: ReactNode }) => <section>{props.children}</section>,
    CardContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    CardHeader: (props: { children: ReactNode }) => <div>{props.children}</div>,
    CardTitle: (props: { children: ReactNode }) => <h2>{props.children}</h2>,
  };
});

vi.mock("@frontend/shadcn/tooltip", () => {
  return {
    Tooltip: (props: { children?: ReactNode; render?: ReactNode }) => (
      <>{props.render ?? props.children}</>
    ),
    TooltipContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    TooltipTrigger: (props: { children?: ReactNode; render?: ReactNode }) => (
      <>{props.render ?? props.children}</>
    ),
    tooltip_trigger_target: (trigger: ReactNode) => <span className="inline-flex">{trigger}</span>,
  };
});

vi.mock("@frontend/widgets/search-bar/search-bar", () => {
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

vi.mock("@frontend/widgets/app-editor/app-editor", () => {
  return {
    AppEditor: (props: { value: string }) => <pre>{props.value}</pre>,
  };
});

vi.mock("@frontend/widgets/app-table/app-table", () => {
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
      selected_row_ids: string[];
      active_row_id: string | null;
      table_class_name?: string;
      on_selection_change?: (payload: {
        selected_row_ids: string[];
        active_row_id: string | null;
        anchor_row_id: string | null;
      }) => void;
      on_row_double_click?: (payload: { row: LogEvent; row_id: string; row_index: number }) => void;
    }) => (
      <>
        <div className={props.table_class_name} data-table-part="header" />
        <div data-slot="scroll-area-viewport">
          <div className={props.table_class_name} data-table-part="body">
            {props.rows.map((event, index) => {
              const row_id = props.get_row_id(event, index);
              const active = props.active_row_id === row_id;
              const selected = props.selected_row_ids.includes(row_id);
              return (
                <div
                  key={row_id}
                  data-log-row-id={row_id}
                  data-active={active ? "true" : undefined}
                  data-selected={selected ? "true" : undefined}
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
                        active,
                        selected,
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
        </div>
      </>
    ),
  };
});

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

function get_active_stream(): StreamController {
  const active_stream = stream_controllers.findLast((controller) => !controller.closed);
  if (active_stream === undefined) {
    throw new Error("没有活动日志流。");
  }
  return active_stream;
}

/** 通过真实流控制器发送事件并冲刷页面缓冲。 */
async function emit_logs(...events: LogEvent[]): Promise<void> {
  await act(async () => {
    for (const event of events) {
      get_active_stream().emit(event);
      await Promise.resolve();
    }
    vi.advanceTimersByTime(500);
  });
}

/** 构造最新在前的三条日志，供按钮和方向键共享同一导航基线。 */
async function emit_navigation_logs(): Promise<void> {
  await emit_logs(
    build_log_event("第一条", { id: "log-1", sequence: 1 }),
    build_log_event("第二条", { id: "log-2", sequence: 2 }),
    build_log_event("第三条", { id: "log-3", sequence: 3 }),
  );
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

  /** 返回页面实际滚动视口，验证回顶行为而不读取组件私有状态。 */
  function get_log_viewport(): HTMLElement {
    const viewport = container?.querySelector('[data-slot="scroll-area-viewport"]');
    if (!(viewport instanceof HTMLElement)) {
      throw new Error("日志滚动视口未挂载。");
    }
    return viewport;
  }

  /** 按用户可见文案定位回顶按钮。 */
  function get_return_to_top_button(): HTMLButtonElement {
    const button = Array.from(container?.querySelectorAll("button") ?? []).find((candidate) => {
      return candidate.textContent?.includes("log_window_page.action.return_to_top") === true;
    });
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("回到顶部按钮未挂载。");
    }
    return button;
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

  it("回到顶部按钮在空列表禁用，点击后滚动并选中最新日志", async () => {
    await mount_page();

    const button = get_return_to_top_button();
    expect(button.disabled).toBe(true);

    await emit_logs(
      build_log_event("第一条", { id: "log-1", sequence: 1 }),
      build_log_event("第二条", { id: "log-2", sequence: 2 }),
    );
    expect(button.disabled).toBe(false);

    const viewport = get_log_viewport();
    viewport.scrollTop = 240;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(viewport.scrollTop).toBe(0);
    expect(
      container?.querySelector('[data-log-row-id="log-2"][data-active="true"]'),
    ).not.toBeNull();
    expect(container?.textContent).toContain("完整详情：log-2");
  });

  it("没有选中日志时在列表长度不变后仍跟随最新日志", async () => {
    await mount_page();
    await emit_logs(build_log_event("", { id: "log-1", sequence: 1 }));

    const viewport = get_log_viewport();
    viewport.scrollTop = 240;
    await emit_logs(build_log_event("", { id: "log-2", sequence: 2 }));

    expect(viewport.scrollTop).toBe(0);
    expect(container?.querySelector('[data-log-row-id="log-1"]')).toBeNull();
    expect(container?.querySelector('[data-log-row-id="log-2"]')).not.toBeNull();
    expect(read_log_detail_mock).not.toHaveBeenCalled();
  });

  it("选中最新日志时继续跟随，主动选择旧日志后暂停", async () => {
    await mount_page();
    await emit_logs(
      build_log_event("第一条", { id: "log-1", sequence: 1 }),
      build_log_event("第二条", { id: "log-2", sequence: 2 }),
    );

    const latest_row = container?.querySelector('[data-log-row-id="log-2"]');
    await act(async () => {
      latest_row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const viewport = get_log_viewport();
    viewport.scrollTop = 240;
    await emit_logs(build_log_event("第三条", { id: "log-3", sequence: 3 }));

    expect(viewport.scrollTop).toBe(0);
    expect(
      container?.querySelector('[data-log-row-id="log-3"][data-active="true"]'),
    ).not.toBeNull();
    expect(container?.textContent).toContain("完整详情：log-3");

    const old_row = container?.querySelector('[data-log-row-id="log-1"]');
    await act(async () => {
      old_row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    viewport.scrollTop = 240;
    await emit_logs(build_log_event("第四条", { id: "log-4", sequence: 4 }));

    expect(viewport.scrollTop).toBe(240);
    expect(
      container?.querySelector('[data-log-row-id="log-1"][data-active="true"]'),
    ).not.toBeNull();
    expect(container?.textContent).toContain("完整详情：log-1");
    expect(read_log_detail_mock).toHaveBeenLastCalledWith("log-1");
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

  it("详情按钮按可见顺序切换上一条和下一条日志", async () => {
    await mount_page();
    await emit_navigation_logs();

    const middle_row = container?.querySelector('[data-log-row-id="log-2"]');
    await act(async () => {
      middle_row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const previous_button = container?.querySelector(
      'button[aria-label="log_window_page.detail.previous"]',
    );
    const next_button = container?.querySelector(
      'button[aria-label="log_window_page.detail.next"]',
    );
    if (
      !(previous_button instanceof HTMLButtonElement) ||
      !(next_button instanceof HTMLButtonElement)
    ) {
      throw new Error("日志前后导航按钮未挂载。");
    }

    expect(previous_button.disabled).toBe(false);
    expect(next_button.disabled).toBe(false);

    await act(async () => {
      previous_button.click();
      await Promise.resolve();
    });
    expect(read_log_detail_mock).toHaveBeenLastCalledWith("log-3");
    expect(previous_button.disabled).toBe(true);

    await act(async () => {
      next_button.click();
      await Promise.resolve();
    });
    expect(read_log_detail_mock).toHaveBeenLastCalledWith("log-2");

    await act(async () => {
      next_button.click();
      await Promise.resolve();
    });
    expect(read_log_detail_mock).toHaveBeenLastCalledWith("log-1");
    expect(next_button.disabled).toBe(true);
  });

  it("收起和展开详情时四个方向键都能切换相邻日志", async () => {
    await mount_page();
    await emit_navigation_logs();

    const middle_row = container?.querySelector('[data-log-row-id="log-2"]');
    await act(async () => {
      middle_row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    /** 发送一个导航键并验证公开详情读取目标。 */
    async function press_and_expect(key: string, expected_event_id: string): Promise<void> {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key }));
        await Promise.resolve();
      });
      expect(read_log_detail_mock).toHaveBeenLastCalledWith(expected_event_id);
    }

    await press_and_expect("ArrowUp", "log-3");
    await press_and_expect("ArrowDown", "log-2");
    await press_and_expect("ArrowRight", "log-1");
    await press_and_expect("ArrowLeft", "log-2");

    await act(async () => {
      middle_row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(container?.querySelector(".log-window-page__content--detail-expanded")).not.toBeNull();

    await press_and_expect("ArrowUp", "log-3");
    await press_and_expect("ArrowDown", "log-2");
    await press_and_expect("ArrowRight", "log-1");
    await press_and_expect("ArrowLeft", "log-2");
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
        content: { kind: "text", text: `完整详情：${id}` },
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
