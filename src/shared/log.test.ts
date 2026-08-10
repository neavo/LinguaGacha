import { describe, expect, it } from "vitest";

import { normalize_log_level, read_log_content } from "./log";

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
    expect(
      read_log_content({
        kind: "analysis_result",
        summary: ["完成"],
        sections: [],
        src_title: "输入",
        srcs: ["原词"],
        result_title: "结果",
        empty_result_text: "无结果",
        terms: [{ src: "猫", dst: "cat", info: "动物" }],
      }),
    ).toEqual({
      kind: "analysis_result",
      summary: ["完成"],
      sections: [],
      src_title: "输入",
      srcs: ["原词"],
      result_title: "结果",
      empty_result_text: "无结果",
      terms: [{ src: "猫", dst: "cat", info: "动物" }],
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
});
