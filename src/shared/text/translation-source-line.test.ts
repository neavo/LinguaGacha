import { describe, expect, it } from "vitest";

import { build_text_preserve_rule } from "./text-preserve-rules";
import { compile_text_replacements } from "./text-replacement-rules";
import { prepare_translation_source_line } from "./translation-source-line";

describe("prepare_translation_source_line", () => {
  it("首尾保护段参与译前替换，恢复依据保留替换前正文", () => {
    const preserve_rule = build_text_preserve_rule({
      mode: "CUSTOM",
      text_type: "TXT",
      entries: [{ src: "<[^>]+>", info: "" }],
    });

    expect(
      prepare_translation_source_line({
        raw_text: "  <A>one</A>  ",
        text_type: "TXT",
        config: { clean_ruby: false },
        preserve_rule,
        pre_replacements: compile_text_replacements([
          { src: "one", dst: "<Q>one", regex: false, case_sensitive: true },
          { src: "A", dst: "B", regex: false, case_sensitive: true },
        ]),
      }),
    ).toMatchObject({
      state: "translatable",
      restoration_text: "<A>one</A>",
      prepared_text: "  <B><Q>one</B>  ",
      leading_whitespace: "  ",
      trailing_whitespace: "  ",
      samples: ["<B>", "<Q>", "</B>"],
      preserve_analysis: {
        text: "  <B><Q>one</B>  ",
        unpreserved_text: "one",
      },
    });
  });
});
