import { describe, expect, it } from "vitest";

import { normalizeProjectChangePayloadMode } from "./project-event";

describe("project event contract", () => {
  it("未知 payload mode 降级为补读而不是误合并", () => {
    expect(normalizeProjectChangePayloadMode("canonical-delta")).toBe("canonical-delta");
    expect(normalizeProjectChangePayloadMode("field-patch")).toBe("field-patch");
    expect(normalizeProjectChangePayloadMode("bad-mode")).toBe("section-invalidated");
  });
});
