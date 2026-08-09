import { describe, expect, it } from "vitest";

import type { MutableJsonRecord } from "../../domain/json";
import {
  apply_proofreading_item_update,
  are_proofreading_item_write_fields_equal,
} from "./proofreading-item-update";

describe("proofreading item update", () => {
  it("非空正文译文默认设为已处理，显式人工状态随后覆盖并清零重试", () => {
    const current = create_item({ status: "ERROR", retry_count: 3 });

    expect(
      apply_proofreading_item_update(current, { dst: "新译文", status: "EXCLUDED" }),
    ).toMatchObject({
      dst: "新译文",
      status: "EXCLUDED",
      retry_count: 0,
    });
  });

  it("只改姓名译文时保留正文状态与姓名数组的其它槽位", () => {
    const current = create_item({
      name_src: ["Alice", "Bob"],
      name_dst: ["旧名", "保留名"],
      status: "ERROR",
      retry_count: 2,
    });

    expect(apply_proofreading_item_update(current, { name_dst: "新名" })).toMatchObject({
      name_dst: ["新名", "保留名"],
      status: "ERROR",
      retry_count: 2,
    });
  });

  it("相等判断只观察校对写入口会持久化的字段", () => {
    const current = create_item();

    expect(
      are_proofreading_item_write_fields_equal(current, {
        ...current,
        src: "不参与比较的原文",
      }),
    ).toBe(true);
    expect(are_proofreading_item_write_fields_equal(current, { ...current, dst: "新译文" })).toBe(
      false,
    );
  });
});

/** 构造共享更新核心实际读取的最小持久 item 事实。 */
function create_item(overrides: MutableJsonRecord = {}): MutableJsonRecord {
  return {
    id: 1,
    src: "原文",
    dst: "",
    name_src: null,
    name_dst: null,
    status: "NONE",
    retry_count: 0,
    ...overrides,
  };
}
