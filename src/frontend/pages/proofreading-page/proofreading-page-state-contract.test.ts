import { describe, expect, it } from "vitest";

import {
  PROOFREADING_REQUIRED_SECTIONS,
  normalize_proofreading_sort_state,
} from "@frontend/pages/proofreading-page/proofreading-page-state-contract";

describe("proofreading-page-state-contract", () => {
  it("声明校对页读取所需的完整项目 section", () => {
    expect(PROOFREADING_REQUIRED_SECTIONS).toEqual(["project", "items", "quality", "proofreading"]);
  });

  it("只恢复受支持的排序列并切断 session 对象引用", () => {
    const sort_state = {
      column_id: "src",
      direction: "descending" as const,
    };

    const normalized = normalize_proofreading_sort_state(sort_state);

    expect(normalized).toEqual(sort_state);
    expect(normalized).not.toBe(sort_state);
    expect(
      normalize_proofreading_sort_state({
        column_id: "removed-column",
        direction: "ascending",
      }),
    ).toBeNull();
    expect(normalize_proofreading_sort_state(null)).toBeNull();
  });
});
