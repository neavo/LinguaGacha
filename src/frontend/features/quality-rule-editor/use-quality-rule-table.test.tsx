import { act, useCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectSessionUiStateProvider } from "@frontend/app/session/project-session-ui-state-provider";
import type { AppTableSortState } from "@frontend/widgets/app-table/app-table-types";
import { useQualityRuleTable } from "./use-quality-rule-table";
import { build_quality_rule_filter_result } from "./quality-rule-filtering";
import {
  canSortQualityRuleStatistics,
  createEmptyQualityRuleStatisticsCacheSnapshot,
  type QualityRuleStatisticsCacheSnapshot,
} from "@frontend/app/session/quality-rule-statistics-store";

vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ project_snapshot: { loaded: true, path: "project.lg" } }),
}));
const entries = [{ entry_id: "apple" }, { entry_id: "pear" }];
const EMPTY_ENTRIES: typeof entries = [];
const empty_statistics = createEmptyQualityRuleStatisticsCacheSnapshot();
const sort_columns = new Set(["src"]);
const create_filter = () => ({ keyword: "apple", scope: "all" as const, is_regex: false });

/** 提供确定的业务筛选，观察表格何时应用查询。 */
function build_result(filter: ReturnType<typeof create_filter>, _sort: AppTableSortState | null) {
  return {
    visible_entries: entries.flatMap((entry, source_index) =>
      entry.entry_id.includes(filter.keyword)
        ? [{ entry, entry_id: entry.entry_id, source_index }]
        : [],
    ),
    invalid_regex_message: null,
  };
}
let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.useRealTimers();
});

it("筛选时冻结旧结果，显式排序立即应用当前条件并取消待执行筛选", () => {
  vi.useFakeTimers();
  let table!: ReturnType<typeof useQualityRuleTable<(typeof entries)[number], "all">>;
  /** 运行真实结果快照和会话状态，只提供测试自有规则。 */
  function Probe() {
    table = useQualityRuleTable({
      key: "quality:glossary",
      project_path: "project.lg",
      section_revision: 1,
      loaded: true,
      readonly: false,
      entries,
      create_filter,
      sort_columns,
      build_result,
      statistics: empty_statistics,
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() =>
    root!.render(
      <ProjectSessionUiStateProvider>
        <Probe />
      </ProjectSessionUiStateProvider>,
    ),
  );
  act(() => table.update_filter_keyword("pear"));
  expect(table.filter_state.keyword).toBe("pear");
  expect(table.filtered_entries.map((row) => row.entry_id)).toEqual(["apple"]);
  act(() => table.apply_table_sort_state({ column_id: "src", direction: "descending" }));
  expect(table.filtered_entries.map((row) => row.entry_id)).toEqual(["pear"]);
  act(() => vi.runAllTimers());
  expect(table.sort_state?.direction).toBe("descending");
  expect(table.filtered_entries.map((row) => row.entry_id)).toEqual(["pear"]);
});

it("读取期间修改筛选不会把临时空列表冻结成正式结果", () => {
  vi.useFakeTimers();
  let table!: ReturnType<typeof useQualityRuleTable<(typeof entries)[number], "all">>;
  /** 通过真实会话状态模拟首次读取和同页重读。 */
  function Probe({ loaded }: { loaded: boolean }) {
    const current_entries = loaded ? entries : EMPTY_ENTRIES;
    // 回调只使用当前已到达的条目，避免夹具提前暴露数据。
    const build = useCallback(
      (filter: ReturnType<typeof create_filter>) => ({
        visible_entries: current_entries.flatMap((entry, source_index) =>
          entry.entry_id.includes(filter.keyword)
            ? [{ entry, entry_id: entry.entry_id, source_index }]
            : [],
        ),
        invalid_regex_message: null,
      }),
      [current_entries],
    );
    table = useQualityRuleTable({
      key: "quality:glossary",
      project_path: "project.lg",
      section_revision: loaded ? 1 : 0,
      loaded,
      readonly: !loaded,
      entries: current_entries,
      create_filter,
      sort_columns,
      build_result: build,
      statistics: empty_statistics,
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  /** 保留页面实例，仅推进读取状态。 */
  const render = (loaded: boolean) =>
    root!.render(
      <ProjectSessionUiStateProvider>
        <Probe loaded={loaded} />
      </ProjectSessionUiStateProvider>,
    );
  act(() => render(false));
  act(() =>
    table.session.set_selection_state({
      selected_row_ids: ["pear"],
      active_row_id: "pear",
      anchor_row_id: "pear",
    }),
  );
  act(() =>
    table.apply_table_selection({ selected_row_ids: [], active_row_id: null, anchor_row_id: null }),
  );
  expect(table.selected_entry_ids).toEqual(["pear"]);
  act(() => table.update_filter_keyword("pear"));
  act(() => vi.runAllTimers());
  act(() => render(true));
  expect(table.filter_state.keyword).toBe("pear");
  expect(table.filtered_entries.map((row) => row.entry_id)).toEqual(["pear"]);
  expect(table.selected_entry_ids).toEqual(["pear"]);
  // 旧防抖输入不能在重读完成后覆盖读取期间的新筛选。
  act(() => table.update_filter_keyword("apple"));
  act(() => render(false));
  act(() => table.update_filter_keyword("pear"));
  act(() => render(true));
  act(() => vi.runAllTimers());
  expect(table.filtered_entries.map((row) => row.entry_id)).toEqual(["pear"]);
});

it("统计到达与失效自动重排，保留排序意图和已有筛选成员", () => {
  const rows = [
    { entry_id: "a", src: "keep first" },
    { entry_id: "b", src: "keep second" },
    { entry_id: "c", src: "excluded" },
  ];
  const columns = new Set(["hit"]);
  const filter = () => ({ keyword: "keep", scope: "all" as const, is_regex: false });
  let table!: ReturnType<typeof useQualityRuleTable<(typeof rows)[number], "all">>;
  /** 用同一页面实例观察统计变化后的成员、顺序和排序选择。 */
  function Probe({ statistics }: { statistics: QualityRuleStatisticsCacheSnapshot }) {
    const build = useCallback(
      (filter_state: ReturnType<typeof filter>, sort_state: AppTableSortState | null) =>
        build_quality_rule_filter_result({
          entries: rows,
          filter_state,
          sort_state,
          hit_state: statistics,
          hit_sort_available: canSortQualityRuleStatistics(statistics),
          select_text: (entry) => entry.src,
          compare_entries: () => 0,
        }),
      [statistics],
    );
    table = useQualityRuleTable({
      key: "quality:glossary",
      project_path: "project.lg",
      section_revision: 1,
      loaded: true,
      readonly: false,
      entries: rows,
      create_filter: filter,
      sort_columns: columns,
      statistics,
      build_result: build,
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  const render = (statistics: QualityRuleStatisticsCacheSnapshot) =>
    act(() =>
      root!.render(
        <ProjectSessionUiStateProvider>
          <Probe statistics={statistics} />
        </ProjectSessionUiStateProvider>,
      ),
    );
  const ids = () => table.filtered_entries.map((row) => row.entry_id);
  render(empty_statistics);
  act(() => table.apply_table_sort_state({ column_id: "hit", direction: "descending" }));
  expect(ids()).toEqual(["a", "b"]);
  const completed: QualityRuleStatisticsCacheSnapshot = {
    ...empty_statistics,
    phase: "current",
    entry_ids: ["a", "b", "c"],
    hits_by_entry_id: { a: 1, b: 5, c: 10 },
  };
  render(completed);
  expect(ids()).toEqual(["b", "a"]);
  rows[0]!.src = "changed";
  render({ ...completed, phase: "failed" });
  expect(ids()).toEqual(["b", "a"]);
  render(empty_statistics);
  expect(ids()).toEqual(["a", "b"]);
  expect(table.sort_state).toEqual({ column_id: "hit", direction: "descending" });
  render({ ...completed, hits_by_entry_id: { a: 8, b: 1 } });
  expect(ids()).toEqual(["a", "b"]);
});
