import { describe, expect, it } from "vitest";

import { format_log_readable_text, normalize_log_level, read_log_content } from "./log";

describe("log 基础模型", () => {
  it("规范化日志等级", () => {
    expect(normalize_log_level("warning")).toBe("warning");
    expect(normalize_log_level("bad")).toBe("info");
  });

  it("严格读取三种日志正文", () => {
    expect(read_log_content({ kind: "text", text: "普通日志" })).toEqual({
      kind: "text",
      text: "普通日志",
    });
    expect(
      read_log_content({
        kind: "translation_result",
        summary: ["完成"],
        sections: [{ title: "思考", text: "过程" }],
        pairs: [{ src: "原文", dst: "译文", actor_src: null, actor_dst: "译名" }],
      }),
    ).toEqual({
      kind: "translation_result",
      summary: ["完成"],
      sections: [{ title: "思考", text: "过程" }],
      pairs: [{ src: "原文", dst: "译文", actor_src: null, actor_dst: "译名" }],
    });
  });

  it("拒绝旧 message、未知 kind 和缺失字段", () => {
    expect(read_log_content({ message: "旧正文" })).toBeNull();
    expect(read_log_content({ kind: "markdown", text: "# 标题" })).toBeNull();
    expect(read_log_content({ kind: "translation_result", summary: [], sections: [] })).toBeNull();
    expect(
      read_log_content({
        kind: "translation_result",
        summary: [],
        sections: [],
        pairs: [{ src: "原文", dst: "译文", actor_src: 1 }],
      }),
    ).toBeNull();
  });

  it("结构化摘要独立承载错误消息并保留诊断调用栈", () => {
    const text = format_log_readable_text({
      content: {
        kind: "translation_result",
        summary: ["用户可见摘要"],
        sections: [],
        pairs: [],
      },
      error: {
        message: "不应单独投影的错误消息",
        stack: "ProviderError\n    at request",
      },
    });

    expect(text).toContain("用户可见摘要");
    expect(text).toContain("ProviderError\n    at request");
    expect(text).not.toContain("不应单独投影的错误消息");
  });
});
