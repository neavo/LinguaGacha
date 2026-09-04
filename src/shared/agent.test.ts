import { describe, expect, it } from "vitest";

import {
  find_agent_reference_ranges,
  format_agent_skill_reference,
  normalize_agent_assistant_message_parts,
  normalize_agent_message_input,
  normalize_agent_revision_request,
  normalize_agent_user_message_text,
} from "./agent";

describe("Agent assistant 消息协议", () => {
  it("删除纯空白并合并相邻同类，同时保留可见正文原值", () => {
    expect(
      normalize_agent_assistant_message_parts([
        { kind: "thinking", text: " \n " },
        { kind: "thinking", text: "检查" },
        { kind: "thinking", text: "\n完成" },
        { kind: "text", text: "\t" },
        { kind: "text", text: " 结论 " },
      ]),
    ).toEqual([
      { kind: "thinking", text: "检查\n完成" },
      { kind: "text", text: " 结论 " },
    ]);
    expect(
      normalize_agent_assistant_message_parts([
        { kind: "thinking", text: " \n " },
        { kind: "text", text: "\t" },
      ]),
    ).toBeNull();
  });
});

describe("Agent 用户消息协议", () => {
  it("拒绝非字符串和纯空白，只裁剪有效正文外缘", () => {
    expect(normalize_agent_user_message_text(null)).toBeNull();
    expect(normalize_agent_user_message_text(["正文"])).toBeNull();
    expect(normalize_agent_user_message_text(" \n ")).toBeNull();
    expect(normalize_agent_user_message_text(" \n 先  用 \n处理 \t")).toBe("先  用 \n处理");
  });

  it("规范文本与有序附件，并允许纯附件消息", () => {
    expect(
      normalize_agent_message_input({
        text: "  处理附件  ",
        attachments: [
          { kind: "image", webpBase64: " image-a " },
          { kind: "response_annotation", selectedText: " 旧回复 ", comment: " 改写 " },
        ],
      }),
    ).toEqual({
      text: "处理附件",
      attachments: [
        { kind: "image", webpBase64: "image-a" },
        { kind: "response_annotation", selectedText: "旧回复", comment: "改写" },
      ],
    });
    expect(
      normalize_agent_message_input({
        text: "",
        attachments: [{ kind: "response_annotation", selectedText: "旧回复", comment: " \n " }],
      }),
    ).toEqual({
      text: "",
      attachments: [{ kind: "response_annotation", selectedText: "旧回复", comment: "" }],
    });
    expect(normalize_agent_message_input({ text: "", attachments: [] })).toBeNull();
    expect(normalize_agent_message_input({ text: "正文" })).toBeNull();
    expect(normalize_agent_message_input({ text: "正文", attachments: [1] })).toBeNull();
    expect(
      normalize_agent_message_input({
        text: "",
        attachments: [{ kind: "response_annotation", selectedText: " ", comment: "评论" }],
      }),
    ).toBeNull();
  });

  it("按输入顺序只保留前十张图片并忽略溢出项", () => {
    const accepted_images = Array.from({ length: 10 }, (_, index) => `image-${index + 1}`);

    expect(
      normalize_agent_message_input({
        text: "",
        attachments: [
          ...accepted_images.map((webpBase64) => ({ kind: "image", webpBase64 })),
          { kind: "image", webpBase64: 1 },
          { kind: "response_annotation", selectedText: "旧回复", comment: "保留" },
        ],
      }),
    ).toEqual({
      text: "",
      attachments: [
        ...accepted_images.map((webpBase64) => ({ kind: "image", webpBase64 })),
        { kind: "response_annotation", selectedText: "旧回复", comment: "保留" },
      ],
    });
  });

  it("规范轮次修订的目标身份与替换消息", () => {
    expect(
      normalize_agent_revision_request({
        entryId: "assistant-1",
        message: { text: " 修订 ", attachments: [] },
      }),
    ).toEqual({ entryId: "assistant-1", message: { text: "修订", attachments: [] } });
    expect(
      normalize_agent_revision_request({ entryId: "", message: { text: "修订", attachments: [] } }),
    ).toBeNull();
    expect(normalize_agent_revision_request({ entryId: "assistant-1" })).toBeNull();
  });

  it("生成固定能力 marker", () => {
    expect(format_agent_skill_reference("glossary-review")).toBe("@skill(glossary-review)");
  });

  it("按长 marker 优先解析未转义引用，并保留偶数反斜线后的真实引用", () => {
    expect(
      find_agent_reference_ranges(
        String.raw`\@skill(review) \\@skill(review) @skill(review-long)`,
        ["@skill(review)", "@skill(review-long)"],
      ),
    ).toEqual([
      { from: 18, to: 32, marker: "@skill(review)" },
      { from: 33, to: 52, marker: "@skill(review-long)" },
    ]);
  });
});
