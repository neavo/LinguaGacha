import { type JSX, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolve_project_session_table_restore_scroll_row_id,
  useProjectSessionTableUiState,
  useProjectSessionUiState,
  type ProjectSessionTableUiStateController,
  type ProjectSessionTableUiState,
} from "@frontend/app/session/project-session-ui-state-context";

// 使用真实表格状态形状，保证测试覆盖 session 写回的公开契约。
type TestTableSortState = {
  column_id: string | null;
};
type TestTableUiState = ProjectSessionTableUiState<{ keyword: string }, TestTableSortState>;
type TestTableUiStateController = ProjectSessionTableUiStateController<
  { keyword: string },
  TestTableSortState
>;

const projects = vi.hoisted(() => ({
  active: "first" as "first" | "second",
  first: { pageUi: new Map() },
  second: { pageUi: new Map() },
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ active_project: projects[projects.active] }),
}));

describe("useProjectSessionTableUiState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_ui_state_api: ReturnType<typeof useProjectSessionUiState> | null = null;
  let latest_table_ui_state: TestTableUiStateController | null = null;
  let render_table_probe = false;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    projects.active = "first";
    projects.first.pageUi.clear();
    projects.second.pageUi.clear();
    container?.remove();
    container = null;
    root = null;
    latest_ui_state_api = null;
    latest_table_ui_state = null;
    render_table_probe = false;
  });

  // 暴露原始 session UI 状态 API，供用例断言项目级读写和清理行为。
  function Probe(): JSX.Element | null {
    const ui_state_api = useProjectSessionUiState();

    useEffect(() => {
      latest_ui_state_api = ui_state_api;
    }, [ui_state_api]);

    return null;
  }

  // 暴露表格适配器，覆盖筛选、排序、选区和恢复滚动的组合写回。
  function TableProbe(): JSX.Element | null {
    const table_ui_state = useProjectSessionTableUiState<{ keyword: string }, TestTableSortState>({
      key: "quality:text_preserve",
      create_default_filter_state: () => ({ keyword: "" }),
      create_default_sort_state: () => ({ column_id: null }),
      clone_filter_state: (filter_state) => ({ ...filter_state }),
      normalize_sort_state: (sort_state) => ({ ...sort_state }),
    });

    useEffect(() => {
      latest_table_ui_state = table_ui_state;
    }, [table_ui_state]);

    return null;
  }

  // 统一 React 根渲染步骤，确保每次断言前 effect 都已刷新。
  async function render_probes(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(
        <>
          <Probe />
          {render_table_probe ? <TableProbe /> : null}
        </>,
      );
    });
  }

  it("切换工程隔离页面状态，切回时恢复", async () => {
    await render_probes();
    latest_ui_state_api?.set_page_ui_state("quality:glossary", "苹果");
    expect(latest_ui_state_api?.get_page_ui_state<string>("quality:glossary")).toBe("苹果");

    projects.active = "second";
    await render_probes();
    expect(latest_ui_state_api?.get_page_ui_state<string>("quality:glossary")).toBeNull();
    latest_ui_state_api?.set_page_ui_state("quality:glossary", "梨");

    projects.active = "first";
    await render_probes();
    expect(latest_ui_state_api?.get_page_ui_state<string>("quality:glossary")).toBe("苹果");
  });

  it("恢复表格状态并将后续筛选、排序和选区写回", async () => {
    await render_probes();
    latest_ui_state_api?.set_page_ui_state<TestTableUiState>("quality:text_preserve", {
      filter_state: { keyword: "苹果" },
      sort_state: { column_id: "src" },
      selected_row_ids: ["row-1", "row-2"],
      active_row_id: "row-2",
      anchor_row_id: "row-1",
    });

    render_table_probe = true;
    await render_probes();

    expect(latest_table_ui_state?.filter_state).toEqual({ keyword: "苹果" });
    expect(latest_table_ui_state?.sort_state).toEqual({ column_id: "src" });
    expect(latest_table_ui_state?.restore_scroll_row_id).toBe("row-1");

    await act(async () => {
      latest_table_ui_state?.set_filter_state({ keyword: "梨" });
      latest_table_ui_state?.set_sort_state({ column_id: "statistics" });
      latest_table_ui_state?.set_selection_state({
        selected_row_ids: ["row-3"],
        active_row_id: "row-3",
        anchor_row_id: "row-3",
      });
    });

    expect(
      latest_ui_state_api?.get_page_ui_state<TestTableUiState>("quality:text_preserve"),
    ).toEqual({
      filter_state: { keyword: "梨" },
      sort_state: { column_id: "statistics" },
      selected_row_ids: ["row-3"],
      active_row_id: "row-3",
      anchor_row_id: "row-3",
    });
  });
});

describe("resolve_project_session_table_restore_scroll_row_id", () => {
  it("单选恢复时使用唯一选中行", () => {
    expect(
      resolve_project_session_table_restore_scroll_row_id({
        selected_row_ids: ["row-2"],
        active_row_id: "row-2",
        anchor_row_id: "row-2",
      }),
    ).toBe("row-2");
  });

  it("多选恢复时使用首个选中行而不是最后激活行或锚点行", () => {
    expect(
      resolve_project_session_table_restore_scroll_row_id({
        selected_row_ids: ["row-1", "row-2", "row-3"],
        active_row_id: "row-3",
        anchor_row_id: "row-3",
      }),
    ).toBe("row-1");
  });
});
