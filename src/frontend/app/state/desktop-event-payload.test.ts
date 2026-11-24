import { describe, expect, it } from "vitest";

import { normalize_section_array, normalize_section_revisions } from "./desktop-event-payload";

describe("desktop-event-payload", () => {
  it("归一化字符串数组并过滤空白项", () => {
    expect(normalize_section_array([" items ", "", null, "quality"])).toEqual(["items", "quality"]);
    expect(normalize_section_array("items")).toEqual([]);
  });

  it("只保留合法 section revision", () => {
    expect(
      normalize_section_revisions({
        items: "2",
        quality: 3,
        batch_translation: 4,
        prompts: Number.NaN,
      }),
    ).toEqual({
      items: 2,
      quality: 3,
    });
    expect(normalize_section_revisions({ batch_translation: 1 })).toBeUndefined();
  });
});
