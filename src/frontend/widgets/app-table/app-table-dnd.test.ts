import { describe, expect, it } from "vitest";

import {
  build_app_table_reordered_row_ids,
  resolve_app_table_drag_group_row_ids,
} from "./app-table-dnd";

describe("app table dnd", () => {
  it("多选拖拽保持选中组，未选中行只移动自身", () => {
    expect(
      resolve_app_table_drag_group_row_ids({
        selection_mode: "multiple",
        active_row_id: "b",
        selected_row_ids: ["b", "c"],
      }),
    ).toEqual(["b", "c"]);
    expect(
      resolve_app_table_drag_group_row_ids({
        selection_mode: "multiple",
        active_row_id: "a",
        selected_row_ids: ["b", "c"],
      }),
    ).toEqual(["a"]);
  });

  it("按源顺序把拖拽组移动到目标行另一侧", () => {
    expect(
      build_app_table_reordered_row_ids({
        ordered_row_ids: ["a", "b", "c", "d"],
        moving_row_ids: ["c", "b"],
        over_row_id: "d",
      }),
    ).toEqual(["a", "d", "b", "c"]);
    expect(
      build_app_table_reordered_row_ids({
        ordered_row_ids: ["a", "b", "c", "d"],
        moving_row_ids: ["b", "c"],
        over_row_id: "b",
      }),
    ).toEqual(["a", "b", "c", "d"]);
  });
});
