import { expect, it } from "vitest";
import { read_translation_for_generation } from "./translation-generation-text";

it("完成接受正文原值，其余状态不提供写回结果", () => {
  for (const dst of ["", "译文", " \n"]) {
    expect(read_translation_for_generation({ status: "PROCESSED", dst })).toBe(dst);
    for (const status of [
      "NONE",
      "ERROR",
      "EXCLUDED",
      "RULE_SKIPPED",
      "LANGUAGE_SKIPPED",
      "DUPLICATED",
    ] as const) {
      expect(read_translation_for_generation({ status, dst })).toBeUndefined();
    }
  }
});
