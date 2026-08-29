import { describe, expect, it } from "vitest";

import { PROJECT_SOURCE_FORMATS } from "./project-source-formats";

describe("PROJECT_SOURCE_FORMATS", () => {
  it("格式 ID 与扩展名互斥且每项都有 Tooltip 说明", () => {
    const format_ids = PROJECT_SOURCE_FORMATS.map((format) => format.id);
    const extensions = PROJECT_SOURCE_FORMATS.map((format) => format.extension);

    expect(new Set(format_ids).size).toBe(format_ids.length);
    expect(new Set(extensions).size).toBe(extensions.length);
    expect(PROJECT_SOURCE_FORMATS.every((format) => format.description_keys.length > 0)).toBe(true);
    expect(PROJECT_SOURCE_FORMATS.map((format) => format.extension)).not.toContain(".pdf");
  });
});
