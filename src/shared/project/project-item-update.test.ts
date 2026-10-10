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
};

describe("project item field patch", () => {
  it("收窄数据库可写字段并丢弃非法字段", () => {
    expect(
      normalize_project_item_field_patch({
        dst: "新译文",
        name_dst: ["新译名", 404, "保留译名"],
        status: "PROCESSED",
        src: "不能写回",
        broken: true,
      }),
    ).toEqual({
      dst: "新译文",
      name_dst: ["新译名", "保留译名"],
      status: "PROCESSED",
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
      }),
    ).toEqual({
      dst: "新译文",
      status: "PROCESSED",
    });
  });

  it("无变化时不生成空 patch", () => {
    expect(build_project_item_field_patch(BASE_ITEM, { ...BASE_ITEM })).toBeNull();
  });
});

describe("project item manual update", () => {
  it.each([null, "", ["", "保留译名"]])(
    "提交相同空可见姓名 %j 保持无变化与字段形状",
    (name_dst) => {
      expect(
        apply_project_item_manual_update(
          { ...BASE_ITEM, name_dst, status: "ERROR" },
          { name_dst: "" },
        ),
      ).toBeNull();
    },
  );

  it("显式完成可以接受空译文", () => {
    expect(
      apply_project_item_manual_update(
        { ...BASE_ITEM, dst: "", name_dst: null, status: "ERROR" },
        { status: "PROCESSED" },
      ),
    ).toEqual({ ...BASE_ITEM, dst: "", name_dst: null, status: "PROCESSED" });
  });
  it.each(["", "新译文"])("正文实际改为 %j 时完成条目", (dst) => {
    expect(
      apply_project_item_manual_update({ ...BASE_ITEM, dst: "旧译文", status: "ERROR" }, { dst }),
    ).toEqual({ ...BASE_ITEM, dst, status: "PROCESSED" });
  });

  it("同值内容不改变失败状态，显式状态可以接受已有译文", () => {
    const current = { ...BASE_ITEM, status: "ERROR" };
    expect(apply_project_item_manual_update(current, { dst: current.dst })).toBeNull();
    expect(apply_project_item_manual_update(current, { name_dst: "旧译名" })).toBeNull();
    expect(apply_project_item_manual_update(current, {})).toBeNull();
    expect(
      apply_project_item_manual_update(current, { dst: current.dst, status: "PROCESSED" }),
    ).toEqual({ ...current, status: "PROCESSED" });
  });

  it.each([{ dst: "新译文" }, { name_dst: "" }])("显式状态覆盖内容修改的完成状态：%j", (update) => {
    expect(
      apply_project_item_manual_update(
        { ...BASE_ITEM, status: "ERROR" },
        { ...update, status: "EXCLUDED" },
      ),
    ).toMatchObject({ status: "EXCLUDED" });
  });

  it.each(["", "新译名"])("可见姓名改为 %j 时完成条目并保留其它槽位", (name_dst) => {
    expect(
      apply_project_item_manual_update({ ...BASE_ITEM, status: "ERROR" }, { name_dst }),
    ).toEqual({
      ...BASE_ITEM,
      name_dst: [name_dst, "保留译名"],
      status: "PROCESSED",
    });
  });
});
