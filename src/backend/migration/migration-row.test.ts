import { describe, expect, it } from "vitest";

import { row_number, row_text } from "./migration-row";

describe("migration-row", () => {
  it("文本列兼容字符串、数值和缺失值", () => {
    const row = { text: "正文", integer: 3, missing: null };

    expect(row_text(row, "text")).toBe("正文");
    expect(row_text(row, "integer")).toBe("3");
    expect(row_text(row, "missing")).toBe("");
  });

  it("整数列兼容 bigint、字符串和缺失值", () => {
    const row = { bigint: 7n, text: "8", missing: null };

    expect(row_number(row, "bigint")).toBe(7);
    expect(row_number(row, "text")).toBe(8);
    expect(row_number(row, "missing")).toBe(0);
  });
});
