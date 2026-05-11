import { describe, expect, it } from "vitest";

import {
  build_ts_conversion_converted_items,
  convert_text_with_optional_preserve,
  normalize_ts_conversion_runtime_items,
} from "@/pages/ts-conversion-page/logic";

const marker_converter = (text: string): string =>
  text.replaceAll("台", "臺").replaceAll("后", "後");

describe("ts-conversion-page logic", () => {
  it("转换译文并保留原始条目以外的运行态字段", () => {
    const items = normalize_ts_conversion_runtime_items({
      1: {
        item_id: 1,
        dst: "后台",
        name_dst: "后藤",
        text_type: "NONE",
      },
    });

    const converted_items = build_ts_conversion_converted_items({
      items,
      direction: "s2t",
      convert_name: true,
      preserve_text: false,
      text_preserve_mode: "off",
      custom_rules: [],
      preset_rules_by_text_type: {},
      converter: marker_converter,
    });

    expect(converted_items).toEqual([
      {
        item_id: 1,
        dst: "後臺",
        name_dst: "後藤",
      },
    ]);
  });

  it("关闭姓名字段转换时保持 name_dst 原样", () => {
    const converted_items = build_ts_conversion_converted_items({
      items: [
        {
          item_id: 1,
          dst: "后台",
          name_dst: ["后台", "台后"],
          text_type: "NONE",
        },
      ],
      direction: "s2t",
      convert_name: false,
      preserve_text: false,
      text_preserve_mode: "off",
      custom_rules: [],
      preset_rules_by_text_type: {},
      converter: marker_converter,
    });

    expect(converted_items[0]?.name_dst).toEqual(["后台", "台后"]);
  });

  it("开启文本保护时跳过命中的代码段", () => {
    const result = convert_text_with_optional_preserve({
      text: "后台{color=#fff}台后",
      converter: marker_converter,
      rules: ["\\{[^}]+\\}"],
      preserve_text: true,
    });

    expect(result).toBe("後臺{color=#fff}臺後");
  });

  it("custom 模式使用自定义文本保护规则", () => {
    const converted_items = build_ts_conversion_converted_items({
      items: [
        {
          item_id: 1,
          dst: "后台[code]台后",
          name_dst: null,
          text_type: "RENPY",
        },
      ],
      direction: "s2t",
      convert_name: true,
      preserve_text: true,
      text_preserve_mode: "custom",
      custom_rules: ["\\[[^\\]]+\\]"],
      preset_rules_by_text_type: {
        RENPY: ["台后"],
      },
      converter: marker_converter,
    });

    expect(converted_items[0]?.dst).toBe("後臺[code]臺後");
  });

  it("非 custom 模式使用对应 text_type 的预置规则", () => {
    const converted_items = build_ts_conversion_converted_items({
      items: [
        {
          item_id: 1,
          dst: "后台[code]台后",
          name_dst: null,
          text_type: "RENPY",
        },
      ],
      direction: "s2t",
      convert_name: true,
      preserve_text: true,
      text_preserve_mode: "smart",
      custom_rules: ["后台"],
      preset_rules_by_text_type: {
        RENPY: ["\\[[^\\]]+\\]"],
      },
      converter: marker_converter,
    });

    expect(converted_items[0]?.dst).toBe("後臺[code]臺後");
  });
});
