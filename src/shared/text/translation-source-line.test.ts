import { describe, expect, it } from "vitest";

import { build_text_preserve_rule } from "./text-preserve-rules";
import { compile_text_replacements } from "./text-replacement-rules";
import { prepare_translation_source_line } from "./translation-source-line";

describe("prepare_translation_source_line", () => {
  it("先抽取保护前缀，再执行译前替换并生成可恢复投影", () => {
    const preserve_rule = build_text_preserve_rule({
      mode: "CUSTOM",
      text_type: "TXT",
      entries: [{ src: "<[^>]+>", info: "" }],
    });

    expect(
      prepare_translation_source_line({
        line_index: 2,
        raw_text: "  <A>one  ",
        text_type: "TXT",
        config: { clean_ruby: false, auto_process_prefix_suffix_preserved_text: true },
        preserve_rule,
        pre_replacements: compile_text_replacements([
          { src: "one", dst: "<Q>one", regex: false, case_sensitive: true },
        ]),
      }),
    ).toEqual({
      line_index: 2,
      raw_text: "  <A>one  ",
      state: "translatable",
      restoration_text: "one",
      model_text: "<Q>one",
      prepared_text: "  <A><Q>one  ",
      leading_whitespace: "  ",
      trailing_whitespace: "  ",
      prefix_segments: ["<A>"],
      suffix_segments: [],
      samples: ["<Q>"],
    });
  });
});
