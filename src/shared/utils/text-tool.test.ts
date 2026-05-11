import { describe, expect, it } from "vitest";

import { TextTool } from "./text-tool";

describe("TextTool", () => {
  it("对齐历史 TextHelper 的标点与分割口径", () => {
    expect(TextTool.is_punctuation_character("，")).toBe(true);
    expect(TextTool.is_punctuation_character("!")).toBe(true);
    expect(TextTool.is_punctuation_character("·")).toBe(true);
    expect(TextTool.is_punctuation_character("¡")).toBe(false);
    expect(TextTool.strip_punctuation("！？测试。")).toBe("测试");
    expect(TextTool.split_by_punctuation("甲，乙 beta", true)).toEqual(["甲", "乙", "beta"]);
  });

  it("解码 UTF-8 BOM 文本", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("hello")]);
    await expect(TextTool.decode(bytes)).resolves.toBe("hello");
  });
});
