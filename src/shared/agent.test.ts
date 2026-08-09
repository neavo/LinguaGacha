import { describe, expect, it } from "vitest";

import {
  find_agent_reference_ranges,
  format_agent_skill_reference,
  format_agent_term_reference,
  normalize_agent_message_input,
  normalize_agent_user_message_text,
} from "./agent";

describe("Agent 用户消息协议", () => {
  it("拒绝非字符串和纯空白，只裁剪有效正文外缘", () => {
    expect(normalize_agent_user_message_text(null)).toBeNull();
    expect(normalize_agent_user_message_text(["正文"])).toBeNull();
    expect(normalize_agent_user_message_text(" \n ")).toBeNull();
    expect(normalize_agent_user_message_text(" \n 先  用 \n处理 \t")).toBe("先  用 \n处理");
  });

  it("规范文本与 WebP 图片，并允许纯图片消息", () => {
    expect(normalize_agent_message_input({ text: "  处理图片  ", images: [" image-a "] })).toEqual({
      text: "处理图片",
      images: ["image-a"],
    });
    expect(normalize_agent_message_input({ text: "", images: ["image-a", "image-b"] })).toEqual({
      text: "",
      images: ["image-a", "image-b"],
    });
    expect(normalize_agent_message_input({ text: "", images: [] })).toBeNull();
    expect(normalize_agent_message_input({ text: "正文" })).toBeNull();
    expect(normalize_agent_message_input({ text: "正文", images: [1] })).toBeNull();
  });

  it("按输入顺序只保留前十张图片并忽略溢出项", () => {
    const accepted_images = Array.from({ length: 10 }, (_, index) => `image-${index + 1}`);

    expect(
      normalize_agent_message_input({ text: "", images: [...accepted_images, 1, "image-12"] }),
    ).toEqual({ text: "", images: accepted_images });
  });

  it("生成固定能力 marker 与原样 Unicode 术语 marker", () => {
    expect(format_agent_skill_reference("glossary-review")).toBe("@skill(glossary-review)");
    for (const term of ["エリス", "爱丽丝", "Alice Smith", "(hero) ✨"]) {
      expect(format_agent_term_reference(term)).toBe(`@term(${term})`);
    }
  });

  it("按长 marker 优先解析未转义引用，并保留偶数反斜线后的真实引用", () => {
    expect(
      find_agent_reference_ranges(String.raw`\@skill(review) \\@skill(review) @term(Alice))`, [
        "@skill(review)",
        "@term(Alice)",
        "@term(Alice))",
      ]),
    ).toEqual([
      { from: 18, to: 32, marker: "@skill(review)" },
      { from: 33, to: 46, marker: "@term(Alice))" },
    ]);
  });
});
