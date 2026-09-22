import { describe, expect, it } from "vitest";

import { format_log_readable_text, normalize_log_level, read_log_content } from "./log";

describe("log 基础模型", () => {
  it("规范化日志等级", () => {
    expect(normalize_log_level("warning")).toBe("warning");
    expect(normalize_log_level("bad")).toBe("info");
  });

  it("展示正文、原始原因和诊断字段", () => {
    expect(format_log_readable_text({ content: "" })).toBe("");
    expect(format_log_readable_text({ content: "第一行\n第二行" })).toBe("第一行\n第二行");
    const text = format_log_readable_text({
      content: "操作失败",
      error: {
        message: "boom",
        stack: "Error: boom\n    at request",
        cause_chain: [{ message: "root cause", context: { phase: "open" } }],
        context: { request_id: "request-1" },
      },
    });
    for (const part of ["操作失败", "boom", "at request", "root cause", "open", "request-1"])
      expect(text).toContain(part);
  });

  it("读取普通文本和翻译对照", () => {
    expect(read_log_content("普通日志")).toBe("普通日志");
    const content = {
      kind: "translation_result",
      started_at: "2026-09-13T00:00:00.000Z",
      ended_at: "2026-09-13T00:00:01.000Z",
      summary: ["完成"],
      sections: [{ title: "思考", text: "过程" }],
      pairs: [{ src: "原文", dst: "译文", actor_src: null, actor_dst: "译名" }],
    };
    expect(read_log_content(content)).toEqual(content);
  });

  it("拒绝未知正文类型和不完整翻译对照", () => {
    expect(read_log_content({ kind: "markdown", text: "# 标题" })).toBeNull();
    expect(
      read_log_content({
        kind: "translation_result",
        started_at: "2026-09-13T00:00:00.000Z",
        ended_at: "2026-09-13T00:00:01.000Z",
        summary: [],
        sections: [],
      }),
    ).toBeNull();
    expect(
      read_log_content({
        kind: "translation_result",
        started_at: "2026-09-13T00:00:00.000Z",
        ended_at: "2026-09-13T00:00:01.000Z",
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
        started_at: "2026-09-13T00:00:00.000Z",
        ended_at: "2026-09-13T00:00:01.000Z",
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
