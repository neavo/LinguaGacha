import { describe, expect, it } from "vitest";

import {
  build_ts_conversion_converted_items,
  normalize_ts_conversion_items,
} from "./ts-conversion";

describe("ts-conversion", () => {
  it("按当前 item 事实归一化导出转换所需字段", () => {
    expect(
      normalize_ts_conversion_items([
        { item_id: 1, dst: "后台", name_dst: ["爱丽丝"], text_type: "renpy" },
        { id: 2, dst: "菜单", name_dst: null, text_type: "" },
      ]),
    ).toEqual([
      { item_id: 1, dst: "后台", name_dst: ["爱丽丝"], text_type: "RENPY" },
      { item_id: 2, dst: "菜单", name_dst: null, text_type: "NONE" },
    ]);
  });

  it("转换 dst 和 name_dst 时按 text_type 应用保护规则", () => {
    const converted_items = build_ts_conversion_converted_items({
      items: [
        { item_id: 1, dst: "后台[code]", name_dst: "后台", text_type: "RENPY" },
        { item_id: 2, dst: "后台", name_dst: null, text_type: "NONE" },
        { item_id: 3, dst: "后台", name_dst: ["后台", "后台保留"], text_type: "NONE" },
        { item_id: 4, dst: "后台", name_dst: ["", "后台保留"], text_type: "NONE" },
      ],
      direction: "s2t",
      convert_name: true,
      preserve_text: true,
      text_preserve_mode: "smart",
      custom_rules: [],
      preset_rules_by_text_type: {
        RENPY: ["\\[[^\\]]+\\]"],
      },
      converter: (text) => text.replaceAll("后台", "後臺"),
    });

    expect(converted_items).toEqual([
      { item_id: 1, dst: "後臺[code]", name_dst: "後臺" },
      { item_id: 2, dst: "後臺", name_dst: null },
      { item_id: 3, dst: "後臺", name_dst: ["後臺", "后台保留"] },
      { item_id: 4, dst: "後臺", name_dst: ["", "后台保留"] },
    ]);
  });
});
