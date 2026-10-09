import { describe, expect, it } from "vitest";

import { QualityRuleSnapshotTool } from "./quality-rule-snapshot";
import { QualityRule } from "../../domain/quality";

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
          revision: "2.8",
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
          revision: "4.8",
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
    expect(snapshot.text_preserve_revision).toBe(2);
    expect(snapshot.translation_prompt_revision).toBe(4);
    expect(snapshot.pre_replacement_revision).toBe(0);
    expect(snapshot.post_replacement_revision).toBe(0);
  });

  it("坏规则事实显式失败", () => {
    expect(() =>
      QualityRuleSnapshotTool.from_json({
        quality: { glossary: { entries: [{ entry_id: "invalid", src: "  ", dst: "忽略" }] } },
      }),
    ).toThrow(TypeError);
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

    expect(snapshot.glossary_enable).toBe(QualityRule.from_json("glossary").default_enabled);
    expect(snapshot.text_preserve_mode).toBe(QualityRule.from_json("text_preserve").default_mode);
    expect(snapshot.pre_replacement_enable).toBe(
      QualityRule.from_json("pre_replacement").default_enabled,
    );
    expect(snapshot.post_replacement_enable).toBe(
      QualityRule.from_json("post_replacement").default_enabled,
    );
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
      },
    });
  });
});
