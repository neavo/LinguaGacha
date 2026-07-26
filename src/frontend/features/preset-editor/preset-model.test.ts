import { describe, expect, it } from "vitest";

import {
  build_user_preset_virtual_id,
  decorate_preset_items,
  has_casefold_duplicate_preset,
  normalize_preset_name,
} from "./preset-model";

describe("preset model", () => {
  it("保持 JSON 与文本预设的既有虚拟路径规则", () => {
    expect(build_user_preset_virtual_id("示例")).toBe("user:示例.json");
    expect(build_user_preset_virtual_id("示例", "txt")).toBe("user:示例.txt");
    expect(normalize_preset_name("  示例  ")).toBe("示例");
  });

  it("忽略大小写检查用户预设重名，并排除当前预设", () => {
    const items = [{ name: "Demo", virtual_id: "user:Demo.json", type: "user" as const }];

    expect(has_casefold_duplicate_preset(items, "user:demo.json", null)).toBe(true);
    expect(has_casefold_duplicate_preset(items, "user:demo.json", "user:Demo.json")).toBe(false);
  });

  it("合并预设并标出默认项", () => {
    expect(
      decorate_preset_items(
        [{ name: "内置", virtual_id: "builtin:default", type: "builtin" }],
        [{ name: "用户", virtual_id: "user:demo.json", type: "user" }],
        "user:demo.json",
      ),
    ).toEqual([
      {
        name: "内置",
        virtual_id: "builtin:default",
        type: "builtin",
        is_default: false,
      },
      {
        name: "用户",
        virtual_id: "user:demo.json",
        type: "user",
        is_default: true,
      },
    ]);
  });
});
