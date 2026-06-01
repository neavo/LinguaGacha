import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProjectSessionUiStateProvider,
  resolve_project_session_table_restore_scroll_row_id,
  useProjectSessionTableUiState,
  useProjectSessionUiState,
  type ProjectSessionTableUiStateController,
  type ProjectSessionTableUiState,
} from "@frontend/app/session/project-session-ui-state-context";

// 只保留 Provider 判断项目身份所需的最小运行态字段。
type RuntimeFixture = {
  project_snapshot: {
    loaded: boolean;
    path: string;
  };
};

// 使用真实表格状态形状，保证测试覆盖 session 写回的公开契约。
type TestUiState = ProjectSessionTableUiState<{ keyword: string }, null>;
type TestTableSortState = {
  column_id: string | null;
};
type TestTableUiState = ProjectSessionTableUiState<{ keyword: string }, TestTableSortState>;
type TestTableUiStateController = ProjectSessionTableUiStateController<
  { keyword: string },
  TestTableSortState
>;

// 测试级共享夹具，让用例可以模拟项目切换和关闭。
const runtime_fixture: { current: RuntimeFixture } = {
  current: {
    project_snapshot: {
      loaded: true,
      path: "E:/demo/sample.lg",
    },
  },
};

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => runtime_fixture.current,
  };
});

describe("ProjectSessionUiStateProvider", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_ui_state_api: ReturnType<typeof useProjectSessionUiState> | null = null;
  let latest_table_ui_state: TestTableUiStateController | null = null;
  let capture_render_ui_state = false;
  let render_table_probe = false;
  let render_ui_state_snapshot: TestUiState | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    latest_ui_state_api = null;
    latest_table_ui_state = null;
    capture_render_ui_state = false;
    render_table_probe = false;
    render_ui_state_snapshot = null;
    runtime_fixture.current = {
      project_snapshot: {
        loaded: true,
        path: "E:/demo/sample.lg",
      },
    };
  });

  // 暴露原始 session UI 状态 API，供用例断言项目级读写和清理行为。
  function Probe(): JSX.Element | null {
    const ui_state_api = useProjectSessionUiState();

    if (capture_render_ui_state) {
      render_ui_state_snapshot = ui_state_api.get_page_ui_state<TestUiState>("quality:glossary");
    }

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

  // render_provider 统一 React 根渲染步骤，确保每次断言前 effect 都已刷新。
  async function render_provider(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(
        <ProjectSessionUiStateProvider>
          <Probe />
          {render_table_probe ? <TableProbe /> : null}
        </ProjectSessionUiStateProvider>,
      );
    });
  }

  // 构造稳定页面状态快照，避免测试把状态字段散落在断言里。
  function create_ui_state(keyword: string): TestUiState {
    return {
      filter_state: { keyword },
      sort_state: null,
      selected_row_ids: ["row-1"],
      active_row_id: "row-1",
      anchor_row_id: "row-1",
    };
  }

  it("同一项目 session 内保留页面 UI 状态", async () => {
    await render_provider();

    latest_ui_state_api?.set_page_ui_state<TestUiState>(
      "quality:glossary",
      create_ui_state("苹果"),
    );
    await render_provider();

    expect(latest_ui_state_api?.get_page_ui_state<TestUiState>("quality:glossary")).toEqual(
      create_ui_state("苹果"),
    );
  });

  it("表格 UI hook 读取已保存状态并连续写入最新快照", async () => {
    await render_provider();
    latest_ui_state_api?.set_page_ui_state<TestTableUiState>("quality:text_preserve", {
      filter_state: { keyword: "苹果" },
      sort_state: { column_id: "src" },
      selected_row_ids: ["row-1", "row-2"],
      active_row_id: "row-2",
      anchor_row_id: "row-1",
    });

    render_table_probe = true;
    await render_provider();

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

  it("项目路径变化或关闭时清空页面 UI 状态", async () => {
    await render_provider();
    latest_ui_state_api?.set_page_ui_state<TestUiState>(
      "quality:glossary",
      create_ui_state("苹果"),
    );

    runtime_fixture.current = {
      project_snapshot: {
        loaded: true,
        path: "E:/demo/other.lg",
      },
    };
    await render_provider();

    expect(latest_ui_state_api?.get_page_ui_state<TestUiState>("quality:glossary")).toBeNull();

    latest_ui_state_api?.set_page_ui_state<TestUiState>("quality:glossary", create_ui_state("梨"));
    runtime_fixture.current = {
      project_snapshot: {
        loaded: false,
        path: "",
      },
    };
    await render_provider();

    expect(latest_ui_state_api?.get_page_ui_state<TestUiState>("quality:glossary")).toBeNull();
  });

  it("项目路径变化后的子组件 render 阶段不会读到旧项目 UI 状态", async () => {
    await render_provider();
    latest_ui_state_api?.set_page_ui_state<TestUiState>(
      "quality:glossary",
      create_ui_state("苹果"),
    );

    runtime_fixture.current = {
      project_snapshot: {
        loaded: true,
        path: "E:/demo/other.lg",
      },
    };
    capture_render_ui_state = true;
    await render_provider();

    expect(render_ui_state_snapshot).toBeNull();
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
