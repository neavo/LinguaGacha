import { describe, expect, it } from "vitest";
import type { ProjectItemPublicRecord } from "../../domain/item";

import {
  applyProjectItemIndexChange,
  cloneProjectItemIndex,
  createProjectItemIndex,
} from "./project-item-index";

/**
 * 构造当前测试场景的标准数据。
 */
function create_test_item(overrides: Partial<ProjectItemPublicRecord>): ProjectItemPublicRecord {
  return {
    item_id: 1,
    src: "",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 0,
    file_type: "TXT",
    file_path: "",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

describe("ProjectItemIndex", () => {
  it("按公开 item_id 建立只读查询索引", () => {
    const index = createProjectItemIndex({
      "1": create_test_item({ item_id: 1, src: "第一行" }),
      "2": create_test_item({ item_id: 2, src: "第二行" }),
    });

    expect(index.size).toBe(2);
    expect(index.get("2")?.src).toBe("第二行");
    expect([...index.keys()]).toEqual(["1", "2"]);
  });

  it("拒绝把缺字段瘦身 item 写入共享索引", () => {
    expect(() =>
      createProjectItemIndex({
        "1": {
          item_id: 1,
          file_path: "chapter01.txt",
        },
      }),
    ).toThrow("runtime.internal_invariant");
  });

  it("规范化增量只变更目标行并保留 clone 边界", () => {
    const index = createProjectItemIndex({
      "1": create_test_item({ item_id: 1, dst: "旧译文", status: "NONE" }),
      "2": create_test_item({ item_id: 2, dst: "保留译文", status: "PROCESSED" }),
    });
    const cloned_index = cloneProjectItemIndex(index);

    const next_index = applyProjectItemIndexChange(index, {
      payloadMode: "canonical-delta",
      upsert: {
        "1": create_test_item({ item_id: 1, dst: "新译文", status: "PROCESSED" }),
      },
      changedIds: [1],
      deleteIds: [2],
    });

    expect(next_index.get(1)?.dst).toBe("新译文");
    expect(next_index.has(2)).toBe(false);
    expect(cloned_index.get(1)?.dst).toBe("旧译文");
    expect(cloned_index.has(2)).toBe(true);
  });

  it("field patch 只合并白名单字段并保留其它 item 事实", () => {
    const index = createProjectItemIndex({
      "1": create_test_item({
        item_id: 1,
        src: "原文",
        dst: "旧译文",
        status: "NONE",
        retry_count: 2,
      }),
      "2": create_test_item({ item_id: 2, dst: "保留译文", status: "EXCLUDED" }),
    });

    const next_index = applyProjectItemIndexChange(index, {
      payloadMode: "field-patch",
      changedIds: [1, 404],
      fieldPatch: {
        status: "PROCESSED",
        retry_count: 0,
      },
    });

    expect(next_index.get(1)).toEqual(
      create_test_item({
        item_id: 1,
        src: "原文",
        dst: "旧译文",
        status: "PROCESSED",
        retry_count: 0,
      }),
    );
    expect(next_index.get(2)).toEqual(
      create_test_item({ item_id: 2, dst: "保留译文", status: "EXCLUDED" }),
    );
    expect(next_index.has(404)).toBe(false);
  });

  it("delta 准备失败时不会污染原索引", () => {
    const index = createProjectItemIndex({
      "1": create_test_item({ item_id: 1, dst: "旧译文", status: "NONE" }),
      "2": create_test_item({ item_id: 2, dst: "保留译文", status: "PROCESSED" }),
    });

    expect(() =>
      applyProjectItemIndexChange(index, {
        payloadMode: "canonical-delta",
        upsert: {
          "1": create_test_item({ item_id: 1, dst: "新译文", status: "PROCESSED" }),
          "3": {
            item_id: 3,
            file_path: "chapter03.txt",
          },
        },
        changedIds: [1],
        deleteIds: [2],
      }),
    ).toThrow("runtime.internal_invariant");

    expect(index.toRecordSnapshot()).toEqual({
      "1": create_test_item({ item_id: 1, dst: "旧译文", status: "NONE" }),
      "2": create_test_item({ item_id: 2, dst: "保留译文", status: "PROCESSED" }),
    });
  });
});
