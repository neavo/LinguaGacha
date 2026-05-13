import { describe, expect, it } from "vitest";

import { LLMClientDegradationDetector } from "./llm-client-degradation-detector";

describe("llm request degradation detector", () => {
  it("识别跨 delta 的单字符重复退化", () => {
    const detector = new LLMClientDegradationDetector();

    expect(detector.feed("啊".repeat(25))).toBe(false);
    expect(detector.feed("啊".repeat(25))).toBe(true);
  });

  it("识别双字符交替重复退化", () => {
    const detector = new LLMClientDegradationDetector();

    expect(detector.feed("天地".repeat(49))).toBe(false);
    expect(detector.feed("天地")).toBe(true);
  });

  it("识别三字符周期重复退化", () => {
    const detector = new LLMClientDegradationDetector();

    expect(detector.feed("甲乙丙".repeat(49))).toBe(false);
    expect(detector.feed("甲乙丙")).toBe(true);
  });

  it("忽略空白并放过普通长文本", () => {
    const detector = new LLMClientDegradationDetector();

    expect(detector.feed("这 是 一 段 正 常 的 翻 译 文 本。".repeat(20))).toBe(false);
  });

  it("最终兜底只扫描输出尾部窗口", () => {
    const normal_prefix = "正常内容".repeat(300);

    expect(
      LLMClientDegradationDetector.has_output_degradation(`${normal_prefix}${"哈".repeat(50)}`),
    ).toBe(true);
  });
});
