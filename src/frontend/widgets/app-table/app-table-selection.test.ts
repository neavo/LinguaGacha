import { describe, expect, it } from "vitest";

import {
  build_app_table_box_selection_change,
  build_app_table_click_selection_change,
  build_app_table_context_selection_change,
  build_app_table_keyboard_selection_change,
  build_app_table_select_all_selection_change,
  normalize_app_table_selection_state,
} from "./app-table-selection";

const ordered_row_ids = ["a", "b", "c", "d"];
const initial_state = {
  selected_row_ids: ["b"],
  active_row_id: "b",
  anchor_row_id: "b",
};

describe("app table selection", () => {
  it("归一化选区时去重并移除已消失的行", () => {
    expect(
      normalize_app_table_selection_state(
        {
          selected_row_ids: ["b", "b", "missing"],
          active_row_id: "missing",
          anchor_row_id: "b",
        },
        ordered_row_ids,
      ),
    ).toEqual({
      selected_row_ids: ["b"],
      active_row_id: null,
      anchor_row_id: "b",
    });
  });

  it("点击与键盘扩展都从锚点形成连续选区", () => {
    expect(
      build_app_table_click_selection_change({
        selection_mode: "multiple",
        ordered_row_ids,
        current_state: initial_state,
        target_row_id: "d",
        extend: false,
        range: true,
      }),
    ).toEqual({
      selected_row_ids: ["b", "c", "d"],
      active_row_id: "d",
      anchor_row_id: "b",
    });
    expect(
      build_app_table_keyboard_selection_change({
        selection_mode: "multiple",
        ordered_row_ids,
        current_state: initial_state,
        action: "next",
        extend: true,
      }),
    ).toEqual({
      selected_row_ids: ["b", "c"],
      active_row_id: "c",
      anchor_row_id: "b",
    });
  });

  it("上下文、框选与全选保留稳定的活动行和锚点", () => {
    expect(
      build_app_table_context_selection_change({
        selection_mode: "multiple",
        current_state: initial_state,
        target_row_id: "b",
      }),
    ).toEqual(initial_state);
    expect(
      build_app_table_box_selection_change({
        current_state: initial_state,
        next_row_ids: ["c", "d"],
      }),
    ).toEqual({
      selected_row_ids: ["c", "d"],
      active_row_id: "d",
      anchor_row_id: "c",
    });
    expect(
      build_app_table_select_all_selection_change({
        ordered_row_ids,
        current_state: initial_state,
      }),
    ).toEqual({
      selected_row_ids: ordered_row_ids,
      active_row_id: "b",
      anchor_row_id: "b",
    });
  });
});
