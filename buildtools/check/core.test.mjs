import { describe, expect, it } from "vitest";

import { find_pattern_errors } from "./core.mjs";

describe("check core", () => {
  it("为正则命中保留源码行号", () => {
    expect(find_pattern_errors("ok\r\nforbidden\nok", /forbidden/g, () => "禁止项")).toEqual([
      { line: 2, message: "禁止项" },
    ]);
  });
});
