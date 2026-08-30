import { describe, expect, it } from "vitest";

import { PROJECT_SOURCE_FORMATS } from "./project-source-formats";

describe("PROJECT_SOURCE_FORMATS", () => {
  it("格式 ID 与扩展名互斥", () => {
    const format_ids = PROJECT_SOURCE_FORMATS.map((format) => format.id);
    const extensions = PROJECT_SOURCE_FORMATS.map((format) => format.extension);

    expect(new Set(format_ids).size).toBe(format_ids.length);
    expect(new Set(extensions).size).toBe(extensions.length);
  });
});
