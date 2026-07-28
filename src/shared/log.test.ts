import { describe, expect, it } from "vitest";

import {
  format_log_content_text,
  format_log_readable_text,
  normalize_log_level,
  read_log_content,
} from "./log";

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

  it("把翻译结果投影为现有纯文本格式并保留多行与姓名", () => {
    expect(
      format_log_content_text({
        kind: "translation_result",
        summary: ["任务完成"],
        sections: [{ title: "思考过程：", text: "第一行\n第二行" }],
        pairs: [
          {
            src: "こんにちは\n世界",
            dst: "你好\n世界",
            actor_src: null,
            actor_dst: "虎铁",
          },
        ],
      }),
    ).toBe(
      "任务完成\n\n思考过程：\n第一行\n第二行\n\n[1]\nSRC: こんにちは\n世界\nACTOR_SRC: null\nDST: 你好\n世界\nACTOR_DST: 虎铁\n",
    );
  });

  it("把分析术语和空结果投影为现有纯文本格式", () => {
    expect(
      format_log_content_text({
        kind: "analysis_result",
        summary: ["任务完成"],
        sections: [],
        src_title: "分析输入：",
        srcs: ["勇者"],
        result_title: "分析结果：",
        empty_result_text: "没有术语",
        terms: [{ src: "勇者", dst: "hero", info: "角色" }],
      }),
    ).toBe("任务完成\n\n分析输入：\nSRC: 勇者\n\n分析结果：\nTERM: 勇者 -> hero #角色\n");
    expect(
      format_log_content_text({
        kind: "analysis_result",
        summary: [],
        sections: [],
        src_title: "分析输入：",
        srcs: [],
        result_title: "分析结果：",
        empty_result_text: "没有术语",
        terms: [],
      }),
    ).toBe("分析结果：\n没有术语\n");
  });

  it("按公开顺序拼接日志正文和错误详情", () => {
    expect(
      format_log_readable_text({
        content: { kind: "text", text: "任务失败" },
        error: {
          message: "底层失败",
          stack: "Error: 底层失败\n    at run",
        },
      }),
    ).toBe("任务失败\n底层失败\nError: 底层失败\n    at run");
  });
});
