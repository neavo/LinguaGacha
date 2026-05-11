import { describe, expect, it } from "vitest";

import { extract_text_name_prefix, inject_text_name_prefix } from "./text-name-prefix";

describe("text-name-prefix", () => {
  it("将姓名注入首行并保持原输入数组不变", () => {
    const srcs = ["こんにちは"];

    expect(inject_text_name_prefix(srcs, "Alice")).toEqual(["【Alice】こんにちは"]);
    expect(srcs).toEqual(["こんにちは"]);
  });

  it("提取全角和半角姓名前缀", () => {
    expect(extract_text_name_prefix("【爱丽丝】你好")).toEqual({ name: "爱丽丝", text: "你好" });
    expect(extract_text_name_prefix("[爱丽丝] 你好")).toEqual({ name: "爱丽丝", text: "你好" });
  });
});
