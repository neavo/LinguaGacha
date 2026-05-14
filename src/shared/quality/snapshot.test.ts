import { describe, expect, it } from "vitest";

import { QualityRuleSnapshotTool } from "./snapshot";

describe("quality rule snapshot", () => {
  it("from_json 收集规则并过滤空 src", () => {
    const snapshot = QualityRuleSnapshotTool.from_json({
      quality: {
        glossary: {
          enabled: true,
          entries: [{ src: "HP", dst: "生命值" }, { src: "  " }],
          revision: 3,
        },
        text_preserve: {
          mode: "SMART",
          entries: [{ src: "<i>", dst: "<i>" }],
          revision: "2",
        },
        pre_replacement: {
          enabled: true,
          entries: [{ src: "A", dst: "B" }],
          revision: -1,
        },
        post_replacement: {
          enabled: true,
          entries: [{ src: "B", dst: "A" }],
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
    expect(snapshot.glossary_entries).toEqual([{ src: "HP", dst: "生命值" }]);
    expect(snapshot.text_preserve_mode).toBe("smart");
    expect(snapshot.text_preserve_entries).toEqual([{ src: "<i>", dst: "<i>" }]);
    expect(snapshot.translation_prompt).toBe("translation-prompt");
    expect(snapshot.pre_replacement_revision).toBe(0);
    expect(snapshot.post_replacement_revision).toBe(0);
    expect(snapshot.analysis_prompt_revision).toBe(5);
  });

  it("get_glossary_entries 返回快照副本", () => {
    const snapshot = QualityRuleSnapshotTool.from_json({
      quality: {
        glossary: {
          enabled: true,
          entries: [{ src: "HP", dst: "生命值" }],
        },
      },
    });

    const entries = QualityRuleSnapshotTool.get_glossary_entries(snapshot);

    expect(entries).toEqual([{ src: "HP", dst: "生命值" }]);
    snapshot.glossary_entries.push({ src: "MP", dst: "魔力" });
    expect(entries).toEqual([{ src: "HP", dst: "生命值" }]);
  });

  it("to_json 输出嵌套质量规则和提示词快照", () => {
    const snapshot = QualityRuleSnapshotTool.from_json({
      quality: {
        glossary: {
          enabled: true,
          entries: [{ src: "HP", dst: "生命值" }],
          revision: 3,
        },
        text_preserve: {
          mode: "custom",
          entries: [{ src: "<i>" }],
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
          entries: [{ src: "HP", dst: "生命值" }],
          enabled: true,
          revision: 3,
        },
        text_preserve: {
          entries: [{ src: "<i>" }],
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
