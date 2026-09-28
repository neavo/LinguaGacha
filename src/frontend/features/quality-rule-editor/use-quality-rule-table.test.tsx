import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectSessionUiStateProvider } from "@frontend/app/session/project-session-ui-state-provider";
import type { AppTableSortState } from "@frontend/widgets/app-table/app-table-types";
import { useQualityRuleTable } from "./use-quality-rule-table";

vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ project_snapshot: { loaded: true, path: "project.lg" } }),
}));
const entries = [{ entry_id: "apple" }, { entry_id: "pear" }];
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
      reset_hit_sort: false,
      build_result,
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
