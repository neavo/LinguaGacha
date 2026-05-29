import { describe, expect, it } from "vitest";

import {
  PRESERVE_RESULT_REFRESH,
  REBUILD_RESULT_REFRESH,
  create_result_refresh,
  create_result_snapshot,
  is_result_refresh_ready,
  materialize_result_snapshot,
  reconcile_result_snapshot,
} from "./snapshot";

describe("result snapshot", () => {
  it("事实源刷新默认只剪除失效 id，不自动吸收新增成员", () => {
    const previous_snapshot = create_result_snapshot({
      applied_query: { keyword: "a" },
      ordered_ids: ["a", "b"],
    });
    const current_snapshot = create_result_snapshot({
      applied_query: { keyword: "a" },
      ordered_ids: ["a", "c"],
    });

    const reconciled_snapshot = reconcile_result_snapshot({
      previous_snapshot,
      current_snapshot,
      valid_id_set: new Set(["a", "c"]),
      refresh_policy: PRESERVE_RESULT_REFRESH,
    });

    expect(reconciled_snapshot.ordered_ids).toEqual(["a"]);
  });

  it("用户显式改变成员集合时按当前事实源重建有序 id", () => {
    const previous_snapshot = create_result_snapshot({
      applied_query: { keyword: "" },
      ordered_ids: ["a"],
    });
    const current_snapshot = create_result_snapshot({
      applied_query: { keyword: "" },
      ordered_ids: ["a", "b"],
    });

    const reconciled_snapshot = reconcile_result_snapshot({
      previous_snapshot,
      current_snapshot,
      valid_id_set: new Set(["a", "b"]),
      refresh_policy: REBUILD_RESULT_REFRESH,
    });

    expect(
      materialize_result_snapshot({
        snapshot: reconciled_snapshot,
        item_by_id: new Map([
          ["a", { label: "旧条目" }],
          ["b", { label: "新条目" }],
        ]),
      }),
    ).toEqual([{ label: "旧条目" }, { label: "新条目" }]);
  });

  it("成员重建请求只有到达目标事实 revision 后才可消费", () => {
    const request = create_result_refresh({
      policy: REBUILD_RESULT_REFRESH,
      source: {
        projectPath: "E:/demo/sample.lg",
        section: "quality",
        revision: 3,
      },
    });

    expect(
      is_result_refresh_ready({
        request,
        current_source_checkpoint: {
          projectPath: "E:/demo/sample.lg",
          sections: {
            quality: 2,
          },
        },
      }),
    ).toBe(false);
    expect(
      is_result_refresh_ready({
        request,
        current_source_checkpoint: {
          projectPath: "E:/demo/sample.lg",
          sections: {
            quality: 3,
          },
        },
      }),
    ).toBe(true);
  });

  it("成员重建请求不会跨项目消费相同 section revision", () => {
    const request = create_result_refresh({
      policy: REBUILD_RESULT_REFRESH,
      source: {
        projectPath: "E:/demo/sample.lg",
        section: "quality",
        revision: 3,
      },
    });

    expect(
      is_result_refresh_ready({
        request,
        current_source_checkpoint: {
          projectPath: "E:/demo/other.lg",
          sections: {
            quality: 10,
          },
        },
      }),
    ).toBe(false);
  });
});
