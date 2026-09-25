import { describe, expect, it } from "vitest";

import { build_text_preserve_rule } from "./text-preserve-rules";
import { compile_text_replacements } from "./text-replacement-rules";
import { prepare_translation_source } from "./translation-source";

describe("prepare_translation_source", () => {
  it("首尾保护段参与译前替换，恢复依据保留替换前正文", () => {
    const preserve_rule = build_text_preserve_rule({
      mode: "CUSTOM",
      text_type: "TXT",
      entries: [{ src: "<[^>]+>", info: "" }],
    });

    expect(
      prepare_translation_source({
        src: "  <A>one</A>  ",
        name_src: null,
        start_ordinal: 0,
        text_type: "TXT",
        config: { clean_ruby: false },
        preserve_rule,
        pre_replacements: compile_text_replacements([
          { src: "one", dst: "<Q>one", regex: false, case_sensitive: true },
          { src: "A", dst: "B", regex: false, case_sensitive: true },
        ]),
      }).prepared_lines[0],
    ).toMatchObject({
      state: "translatable",
      restoration_text: "<A>one</A>",
      prepared_text: "  <B><Q>one</B>  ",
      leading_whitespace: "  ",
      trailing_whitespace: "  ",
      preserve_analysis: {
        text: "  <B><Q>one</B>  ",
        unpreserved_text: expect.stringMatching(/^\s+one\s+$/u),
      },
    });
  });
  it("完整入口先隔离资源，正文执行清理和替换，姓名保留整段输入", () => {
    const preserve_rule = build_text_preserve_rule({ mode: "off", text_type: "NONE", entries: [] });
    const result = prepare_translation_source({
      src: "甘岸久弥[https://mypage.syosetu.com/1300935/]\r\n[漢字/かんじ]: https://example.com/(a)",
      name_src: "[姓名/せいめい]: https://example.com/name",
      text_type: "NONE",
      config: { clean_ruby: true },
      preserve_rule,
      start_ordinal: 4,
      pre_replacements: compile_text_replacements([
        { src: ":", dst: "：", regex: false, case_sensitive: true },
      ]),
    });
    expect(result.name?.text).toBe("[姓名/せいめい]: lg-uri/4");
    expect(result.prepared_lines.map((line) => line.prepared_text)).toEqual([
      "甘岸久弥[lg-uri/5]",
      "漢字： lg-uri/6",
    ]);
    expect(result.body.mappings.map((mapping) => mapping.value)).toEqual([
      "https://mypage.syosetu.com/1300935/",
      "https://example.com/(a)",
    ]);
    expect(result.body.next_ordinal).toBe(7);
  });
});
