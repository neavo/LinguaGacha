import { describe, expect, it } from "vitest";

import { EscapeFixer } from "./escape-fixer";

describe("EscapeFixer", () => {
  it("把真实换行还原成反斜杠 n 字面量", () => {
    const src = String.raw`\\n[1]`;
    const dst = "line1\nline2";

    expect(EscapeFixer.fix(src, dst)).toBe(String.raw`line1\\nline2`);
  });

  it("源文和译文转义段数量不一致时仅返回换行归一化后的译文", () => {
    const src = String.raw`\\a\\b\\c`;
    const dst = String.raw`\\a\\\\b`;

    expect(EscapeFixer.fix(src, dst)).toBe(dst);
  });

  it("源文和译文转义段数量一致时按源文逐段对齐", () => {
    const src = String.raw`\\\\n[1] \\\\E`;
    const dst = String.raw`\\n[1] \\E`;

    expect(EscapeFixer.fix(src, dst)).toBe(src);
  });

  it("源文和译文转义段已经一致时保持译文不变", () => {
    const src = String.raw`\\n[1]\\E`;
    const dst = String.raw`\\n[1]\\E`;

    expect(EscapeFixer.fix(src, dst)).toBe(dst);
  });

  it("源文没有转义段时仍返回换行归一化后的译文", () => {
    const src = "普通文本";
    const dst = "第一行\n第二行";

    expect(EscapeFixer.fix(src, dst)).toBe(String.raw`第一行\n第二行`);
  });
});
