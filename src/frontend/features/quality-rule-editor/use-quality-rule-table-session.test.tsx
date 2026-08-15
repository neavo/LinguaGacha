import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useQualityRuleResultControls } from "./use-quality-rule-table-session";

type TestControls = ReturnType<typeof useQualityRuleResultControls<"all", string, string, string>>;

describe("useQualityRuleResultControls", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let controls: TestControls | null = null;

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
    controls = null;
  });

  it("筛选时冻结旧结果并防抖，排序时立即应用当前条件", () => {
    const schedule = vi.fn();
    const cancel = vi.fn();

    function Probe(): JSX.Element {
      const [filter_state, set_filter_state] = useState({
        keyword: "old",
        scope: "all" as const,
        is_regex: false,
      });
      const [sort_state, set_sort_state] = useState("ascending");
      const [snapshot, set_snapshot] = useState<string | null>(null);
      controls = useQualityRuleResultControls({
        filter_state,
        sort_state,
        build_result_snapshot: (filter, sort) => `${filter.keyword}:${sort}`,
        set_result_snapshot: set_snapshot,
        set_filter_state,
        set_sort_state,
        debounced_result_snapshot: { schedule, cancel },
        resolve_sort_state: (sort) => sort,
      });

      return <output>{`${filter_state.keyword}|${sort_state}|${snapshot ?? "none"}`}</output>;
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<Probe />));

    act(() => controls?.update_filter_keyword("new"));
    expect(container.textContent).toBe("new|ascending|old:ascending");
    expect(schedule).toHaveBeenCalledWith(
      { keyword: "new", scope: "all", is_regex: false },
      "ascending",
    );

    act(() => controls?.apply_table_sort_state("descending"));
    expect(cancel).toHaveBeenCalledOnce();
    expect(container.textContent).toBe("new|descending|new:descending");
  });
});
