import { describe, expect, it } from "vitest";

import {
  apply_project_item_manual_update,
  apply_project_item_field_patch,
  build_project_item_field_patch,
  normalize_project_item_field_patch,
} from "./project-item-update";

const BASE_ITEM = {
  dst: "旧译文",
  name_dst: ["旧译名", "保留译名"],
  status: "NONE",
  retry_count: 2,
};

describe("project item field patch", () => {
  it("收窄项目事件可传播字段并丢弃非法字段", () => {
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

  it("坏状态和非对象不生成字段补丁", () => {
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

describe("project item manual update", () => {
  it.each(["", "新译文"])("正文实际改为 %j 时完成条目并清除重试历史", (dst) => {
    expect(
      apply_project_item_manual_update(
        { ...BASE_ITEM, dst: "旧译文", status: "ERROR", retry_count: 3 },
        { dst },
      ),
    ).toEqual({ ...BASE_ITEM, dst, status: "PROCESSED", retry_count: 0 });
  });

  it("相同非空译文可确认错误结果，纯 no-op 不清除重试历史", () => {
    expect(
      apply_project_item_manual_update(
        { ...BASE_ITEM, status: "ERROR", retry_count: 3 },
        { dst: "旧译文" },
      ),
    ).toEqual({ ...BASE_ITEM, status: "PROCESSED", retry_count: 0 });
    expect(
      apply_project_item_manual_update(
        { ...BASE_ITEM, status: "PROCESSED", retry_count: 3 },
        { dst: "旧译文" },
      ),
    ).toBeNull();
  });

  it("显式状态覆盖正文默认状态并清零重试", () => {
    expect(
      apply_project_item_manual_update(
        { ...BASE_ITEM, status: "ERROR", retry_count: 3 },
        { dst: "新译文", status: "EXCLUDED" },
      ),
    ).toEqual({ ...BASE_ITEM, dst: "新译文", status: "EXCLUDED", retry_count: 0 });
  });

  it("只修改姓名译文时保留正文状态、重试历史和其它姓名槽位", () => {
    expect(
      apply_project_item_manual_update(
        { ...BASE_ITEM, status: "ERROR", retry_count: 2 },
        { name_dst: "新译名" },
      ),
    ).toEqual({
      ...BASE_ITEM,
      name_dst: ["新译名", "保留译名"],
      status: "ERROR",
      retry_count: 2,
    });
  });
});
