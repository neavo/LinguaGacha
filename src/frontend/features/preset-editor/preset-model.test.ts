import { describe, expect, it } from "vitest";

import {
  build_user_preset_virtual_id,
  decorate_preset_items,
  has_casefold_duplicate_preset,
} from "./preset-model";

describe("preset model", () => {
  it("忽略大小写检查用户预设重名，并排除当前预设", () => {
    const id = "user:Português.txt";
    const items = [{ name: "Português", virtual_id: id, type: "user" as const }];
    const target_id = build_user_preset_virtual_id("português".normalize("NFD"), "txt");

    expect(has_casefold_duplicate_preset(items, target_id, null)).toBe(true);
    expect(has_casefold_duplicate_preset(items, target_id, id.normalize("NFD"))).toBe(false);
  });

  it("合并预设并标出默认项", () => {
    expect(
      decorate_preset_items(
        [{ name: "内置", virtual_id: "builtin:default", type: "builtin" }],
        [{ name: "用户", virtual_id: "user:한국어.txt", type: "user" }],
        "user:한국어.txt".normalize("NFD"),
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
        virtual_id: "user:한국어.txt",
        type: "user",
        is_default: true,
      },
    ]);
  });
});
