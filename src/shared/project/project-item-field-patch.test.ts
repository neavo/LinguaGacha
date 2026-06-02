import { describe, expect, it } from "vitest";

import {
  apply_project_item_field_patch,
  build_project_item_field_patch,
  normalize_project_item_field_patch,
} from "./project-item-field-patch";

const BASE_ITEM = {
  dst: "旧译文",
  name_dst: ["旧译名", "保留译名"],
  status: "NONE",
  retry_count: 2,
};

describe("project item field patch", () => {
  it("收窄四个校对可写字段并丢弃非法字段", () => {
    expect(
      normalize_project_item_field_patch({
        dst: "新译文",
        name_dst: ["新译名", 404, "保留译名"],
        status: "PROCESSED",
        retry_count: 2.8,
        src: "不能写回",
        broken: true,
      }),
    ).toEqual({
      dst: "新译文",
      name_dst: ["新译名", "保留译名"],
      status: "PROCESSED",
      retry_count: 2,
    });
  });

  it("坏状态和空 patch 返回 null，让调用方走补读或空结果", () => {
    expect(normalize_project_item_field_patch({ status: "BROKEN" })).toBeNull();
    expect(normalize_project_item_field_patch(null)).toBeNull();
  });

  it("应用 patch 时按姓名字段内容比较数组", () => {
    const unchanged = apply_project_item_field_patch(BASE_ITEM, {
      name_dst: ["旧译名", "保留译名"],
    });
    const changed = apply_project_item_field_patch(BASE_ITEM, {
      name_dst: ["新译名", "保留译名"],
    });

    expect(unchanged).toBeNull();
    expect(changed).toEqual({
      ...BASE_ITEM,
      name_dst: ["新译名", "保留译名"],
    });
  });

  it("从 current 和 next 构造实际变化字段", () => {
    expect(
      build_project_item_field_patch(BASE_ITEM, {
        dst: "新译文",
        name_dst: ["旧译名", "保留译名"],
        status: "PROCESSED",
        retry_count: 0,
      }),
    ).toEqual({
      dst: "新译文",
      status: "PROCESSED",
      retry_count: 0,
    });
  });

  it("无变化时不生成空 patch", () => {
    expect(build_project_item_field_patch(BASE_ITEM, { ...BASE_ITEM })).toBeNull();
  });
});
