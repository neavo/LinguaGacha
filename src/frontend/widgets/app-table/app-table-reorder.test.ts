import { describe, expect, it } from "vitest";

import { build_app_table_reordered_row_ids, type AppTableReorderTarget } from "./app-table-reorder";

describe("app table reorder", () => {
  it.each<{ target: AppTableReorderTarget; expected: string[] }>([
    { target: "top", expected: ["a", "c", "b", "d", "e"] },
    { target: "bottom", expected: ["b", "d", "e", "a", "c"] },
    { target: { row_id: "b" }, expected: ["a", "c", "b", "d", "e"] },
    { target: { row_id: "d" }, expected: ["b", "d", "a", "c", "e"] },
    { target: { row_id: "a" }, expected: ["a", "b", "c", "d", "e"] },
  ])("向 $target 移动时保留移动组和剩余行的原顺序", ({ target, expected }) => {
    const ordered_row_ids = ["a", "b", "c", "d", "e"];
    expect(
      build_app_table_reordered_row_ids({
        ordered_row_ids,
        moving_row_ids: ["c", "a"],
        target,
      }),
    ).toEqual(expected);
    expect(ordered_row_ids).toEqual(["a", "b", "c", "d", "e"]);
  });

  it.each<{ moving_row_ids: string[]; target: AppTableReorderTarget; expected: string[] }>([
    { moving_row_ids: ["d", "b"], target: "bottom", expected: ["a", "c", "b", "d"] },
    { moving_row_ids: ["a", "b"], target: "top", expected: ["a", "b", "c", "d"] },
    { moving_row_ids: ["c", "d"], target: "bottom", expected: ["a", "b", "c", "d"] },
    { moving_row_ids: ["d", "c", "b", "a"], target: "top", expected: ["a", "b", "c", "d"] },
    { moving_row_ids: [], target: "bottom", expected: ["a", "b", "c", "d"] },
  ])("首尾行、全选与空选区按实际顺序处理：$moving_row_ids → $target", (args) => {
    expect(
      build_app_table_reordered_row_ids({
        ordered_row_ids: ["a", "b", "c", "d"],
        moving_row_ids: args.moving_row_ids,
        target: args.target,
      }),
    ).toEqual(args.expected);
  });
});
