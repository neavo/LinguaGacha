import { describe, expect, it } from "vitest";

import { QualityRuleSnapshotTool } from "./quality-rule-snapshot";

describe("quality rule snapshot", () => {
  it("from_json 收集并类型化各类规则", () => {
    const snapshot = QualityRuleSnapshotTool.from_json({
      quality: {
        glossary: {
          enabled: true,
          entries: [{ entry_id: "hp", src: "HP", dst: "生命值", info: "", case_sensitive: false }],
          revision: 3,
        },
        text_preserve: {
          mode: "SMART",
          entries: [{ entry_id: "italic", src: "<i>", dst: "<i>" }],
          revision: "2",
        },
        pre_replacement: {
          enabled: true,
          entries: [{ entry_id: "a-to-b", src: "A", dst: "B" }],
          revision: -1,
        },
        post_replacement: {
          enabled: true,
          entries: [{ entry_id: "b-to-a", src: "B", dst: "A" }],
          revision: "bad",
        },
      },
      prompts: {
        translation: {
          enabled: true,
          text: "translation-prompt",
          revision: 4,
        },
        analysis: {
          enabled: false,
          text: "",
          revision: "5",
        },
      },
    });

    expect(snapshot.glossary_enable).toBe(true);
    expect(snapshot.glossary_entries).toEqual([
      { entry_id: "hp", src: "HP", dst: "生命值", info: "", case_sensitive: false },
    ]);
    expect(snapshot.text_preserve_mode).toBe("smart");
    expect(snapshot.text_preserve_entries).toEqual([{ entry_id: "italic", src: "<i>", info: "" }]);
    expect(snapshot.translation_prompt).toBe("translation-prompt");
    expect(snapshot.pre_replacement_revision).toBe(0);
    expect(snapshot.post_replacement_revision).toBe(0);
    expect(snapshot.analysis_prompt_revision).toBe(5);
  });

  it("坏规则事实显式失败", () => {
    expect(() =>
      QualityRuleSnapshotTool.from_json({
        quality: { glossary: { entries: [{ entry_id: "invalid", src: "  ", dst: "忽略" }] } },
      }),
    ).toThrow("Quality rule src must not be empty.");
  });

  it("缺少质量规则 meta 时使用统一领域默认值", () => {
    const snapshot = QualityRuleSnapshotTool.from_json({
      quality: {
        glossary: {
          entries: [{ entry_id: "hp", src: "HP", dst: "生命值", info: "", case_sensitive: false }],
        },
        text_preserve: {
          entries: [{ entry_id: "italic", src: "<i>", dst: "<i>" }],
        },
      },
    });

    expect(snapshot.glossary_enable).toBe(true);
    expect(snapshot.text_preserve_mode).toBe("smart");
    expect(snapshot.pre_replacement_enable).toBe(false);
    expect(snapshot.post_replacement_enable).toBe(false);
  });

  it("to_json 输出嵌套质量规则和提示词快照", () => {
    const snapshot = QualityRuleSnapshotTool.from_json({
      quality: {
        glossary: {
          enabled: true,
          entries: [{ entry_id: "hp", src: "HP", dst: "生命值" }],
          revision: 3,
        },
        text_preserve: {
          mode: "custom",
          entries: [{ entry_id: "italic", src: "<i>", info: "" }],
          revision: 2,
        },
      },
      prompts: {
        translation: {
          enabled: true,
          text: "prompt",
          revision: 7,
        },
      },
    });

    expect(QualityRuleSnapshotTool.to_json(snapshot)).toEqual({
      quality: {
        glossary: {
          entries: [{ entry_id: "hp", src: "HP", dst: "生命值", info: "", case_sensitive: false }],
          enabled: true,
          revision: 3,
        },
        text_preserve: {
          entries: [{ entry_id: "italic", src: "<i>", info: "" }],
          mode: "custom",
          revision: 2,
        },
        pre_replacement: {
          entries: [],
          enabled: false,
          revision: 0,
        },
        post_replacement: {
          entries: [],
          enabled: false,
          revision: 0,
        },
      },
      prompts: {
        translation: {
          text: "prompt",
          enabled: true,
          revision: 7,
        },
        analysis: {
          text: "",
          enabled: false,
          revision: 0,
        },
      },
    });
  });
});
