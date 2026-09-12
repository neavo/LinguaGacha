import type {
  AppTableProps,
  AppTableDataColumn,
} from "@frontend/widgets/app-table/app-table-types";
import type { ReactNode } from "react";
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "@shared/log";
import { LogWindowPage } from "./page";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

const mocks = vi.hoisted(() => ({
  entries: [] as LogEntry[],
  older: vi.fn(),
  refresh: vi.fn(),
  detail: vi.fn(),
  date: "20260913",
  following: true,
  set_following: vi.fn(),
  select_date: vi.fn(),
  refresh_dates: vi.fn(),
  failed: false,
  loading: false,
  has_older: true,
}));
vi.mock("./use-log-pages", () => ({
  useLogPages: () => ({
    entries: mocks.entries,
    date: mocks.date,
    following: mocks.following,
    set_following: mocks.set_following,
    select_date: mocks.select_date,
    refresh_dates: mocks.refresh_dates,
    dates: ["20260913"],
    loading: mocks.loading,
    failed: mocks.failed,
    reset_revision: 0,
    expired: false,
    can_load_older: mocks.has_older,
    load_older: mocks.older,
    refresh: mocks.refresh,
  }),
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ read_log_detail: mocks.detail }));
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

vi.mock("@frontend/widgets/app-editor/app-editor", () => {
  return {
    AppEditor: (props: { value: string }) => <pre>{props.value}</pre>,
  };
});

vi.mock("@frontend/widgets/app-table/app-table", () => {
  return {
    AppTable: (
      props: Pick<
        AppTableProps<LogEntry>,
        | "rows"
        | "get_row_id"
        | "selected_row_ids"
        | "active_row_id"
        | "table_class_name"
        | "on_selection_change"
        | "on_row_activate"
      > & {
        columns: Pick<AppTableDataColumn<LogEntry>, "id" | "render_cell">[];
      },
    ) => (
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
                    props.on_row_activate?.(row_id);
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

describe("日志窗口", () => {
  it("打开日期菜单刷新可选文件", async () => {
    await mount();
    const date_button = [...container!.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("2026-09-13"),
    );
    await act(async () => {
      date_button?.click();
    });
    expect(mocks.refresh_dates).toHaveBeenCalledOnce();
  });
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    mocks.entries = [];
    mocks.failed = false;
    mocks.following = true;
    mocks.loading = false;
    mocks.has_older = true;
    vi.clearAllMocks();
  });
  /** 挂载隔离的日志页面，便于观察用户交互结果。 */
  async function mount(): Promise<void> {
    mocks.set_following.mockImplementation((value: boolean) => {
      mocks.following = value;
    });
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock(),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.entries = [1, 2].map((line) => ({
      id: `20260913:${String(line)}`,
      date: "20260913",
      line,
      revision: "rev",
      created_at: "2026-09-13T00:00:00Z",
      source: "test",
      level: "info",
      message_preview: `摘要${String(line)}`,
      message_length: 3,
    }));
    mocks.detail.mockImplementation(async (id: string) => ({
      ...mocks.entries.find((entry) => entry.id === id),
      content: { kind: "text", text: `详情${id}` },
    }));
    await act(async () => {
      root!.render(
        <StrictMode>
          <LogWindowPage />
        </StrictMode>,
      );
    });
  }
  it("列表按文件位置排序，选中后读取详情并支持方向键导航", async () => {
    await mount();
    const rows = container!.querySelectorAll<HTMLElement>("[data-log-row-id]");
    expect(rows[0]?.textContent).toContain("摘要2");
    await act(async () => {
      rows[0]?.click();
    });
    expect(mocks.detail).toHaveBeenLastCalledWith("20260913:2", "rev", expect.any(AbortSignal));
    expect(container!.textContent).toContain("详情20260913:2");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });
    expect(mocks.detail).toHaveBeenLastCalledWith("20260913:1", "rev", expect.any(AbortSignal));
  });
  it("接近底部自动翻页，保持选择，回到顶部和整体读取错误仍可重试", async () => {
    await mount();
    const buttons = [...container!.querySelectorAll("button")];
    const viewport = container!.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    Object.defineProperties(viewport, {
      clientHeight: { value: 300, configurable: true },
      scrollHeight: { value: 2000, configurable: true },
    });
    await act(async () => {
      container!.querySelector<HTMLElement>('[data-log-row-id="20260913:2"]')!.click();
      viewport.scrollTop = 500;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(mocks.older).not.toHaveBeenCalled();
    await act(async () => {
      viewport.scrollTop = 1700;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(
      container!.querySelector('[data-log-row-id="20260913:2"]')?.getAttribute("data-selected"),
    ).toBe("true");
    expect(mocks.older).toHaveBeenCalledOnce();
    await act(async () => {
      buttons
        .find((button) => button.textContent?.includes("log_window_page.action.return_to_top"))
        ?.click();
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    mocks.failed = true;
    await act(async () => {
      root!.render(
        <StrictMode>
          <LogWindowPage />
        </StrictMode>,
      );
    });
    expect(container!.textContent).toContain("log_window_page.history.failed");
  });
  it("正在读取或没有更早记录时滚动不触发额外请求", async () => {
    await mount();
    mocks.loading = true;
    await act(async () => {
      root!.render(
        <StrictMode>
          <LogWindowPage />
        </StrictMode>,
      );
    });
    const viewport = container!.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    Object.defineProperties(viewport, {
      clientHeight: { value: 300 },
      scrollHeight: { value: 1000 },
    });
    await act(async () => {
      viewport.scrollTop = 700;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(mocks.older).not.toHaveBeenCalled();
    mocks.loading = false;
    mocks.has_older = false;
    await act(async () => {
      root!.render(
        <StrictMode>
          <LogWindowPage />
        </StrictMode>,
      );
    });
    await act(async () => {
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(mocks.older).not.toHaveBeenCalled();
  });
});
