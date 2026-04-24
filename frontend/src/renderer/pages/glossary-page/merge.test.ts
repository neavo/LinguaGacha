import { describe, expect, it } from "vitest";

import { merge_glossary_entries } from "@/pages/glossary-page/merge";

describe("merge_glossary_entries", () => {
  it("导入空译文时不会覆盖已有非空译文", () => {
    const result = merge_glossary_entries(
      [
        {
          src: "Alice",
          dst: "爱丽丝",
          info: "main character",
          case_sensitive: false,
        },
      ],
      [
        {
          src: "Alice",
          dst: "",
          info: "",
          case_sensitive: false,
        },
      ],
    );

    expect(result.merged_entries).toEqual([
      {
        src: "Alice",
        dst: "爱丽丝",
        info: "",
        case_sensitive: false,
      },
    ]);
  });
});
