import { describe, expect, it } from "vitest";

import { compile_literal_patterns, normalize_literal_text } from "./literal-matcher";

describe("共享字面量匹配器", () => {
  it("同批区分大小写规则，并按输入 key 顺序保留重复文本身份", () => {
    const matcher = compile_literal_patterns([
      { key: "sensitive", text: "HP", case_sensitive: true },
      { key: "folded-a", text: "straße", case_sensitive: false },
      { key: "folded-b", text: "STRASSE", case_sensitive: false },
    ]);

    expect(matcher.match("hp STRASSE Straße")).toEqual([
      {
        key: "folded-a",
        ranges: [
          { start: 3, end: 10 },
          { start: 11, end: 17 },
        ],
      },
      {
        key: "folded-b",
        ranges: [
          { start: 3, end: 10 },
          { start: 11, end: 17 },
        ],
      },
    ]);
  });

  it("保留重叠命中与原文 UTF-16 范围", () => {
    const matcher = compile_literal_patterns([
      { key: "aa", text: "aa", case_sensitive: true },
      { key: "emoji", text: "😀", case_sensitive: true },
      { key: "ss", text: "ss", case_sensitive: false },
    ]);

    expect(matcher.match("aaa\r\n😀ß")).toEqual([
      {
        key: "aa",
        ranges: [
          { start: 0, end: 2 },
          { start: 1, end: 3 },
        ],
      },
      { key: "emoji", ranges: [{ start: 5, end: 7 }] },
      { key: "ss", ranges: [{ start: 7, end: 8 }] },
    ]);
  });

  it("scan 只流式返回实际命中和原文范围", () => {
    const matcher = compile_literal_patterns([
      { key: "root", text: "城", case_sensitive: true },
      { key: "full", text: "白之城", case_sensitive: true },
      { key: "miss", text: "港口", case_sensitive: true },
    ]);
    const matches: Array<{ key: string; start: number; end: number }> = [];

    matcher.scan("白之城", (key, range) => matches.push({ key, ...range }));

    expect(matches).toEqual([
      { key: "full", start: 0, end: 3 },
      { key: "root", start: 2, end: 3 },
    ]);
  });

  it("布尔匹配与完整范围匹配保持相同的 Unicode 语义", () => {
    const matcher = compile_literal_patterns([
      { key: "folded", text: "STRASSE", case_sensitive: false },
      { key: "sigma", text: "ΟΣ", case_sensitive: false },
      { key: "accent", text: "é", case_sensitive: false },
      { key: "hangul", text: "가", case_sensitive: false },
      { key: "kana", text: "カタカナ", case_sensitive: false },
      { key: "emoji", text: "👩‍💻", case_sensitive: true },
      { key: "sensitive", text: "JK", case_sensitive: true },
    ]);
    const texts = [
      "无关文本",
      "Straße",
      "前缀 ος 后缀",
      "组合字符 e\u0301",
      "韩文 Jamo 가",
      "半角假名 ｶﾀｶﾅ",
      "emoji 👩‍💻 test",
      "全角 ＪＫ",
      "小写 ｊｋ",
    ];

    for (const text of texts) {
      expect(matcher.matches(text), text).toBe(matcher.match(text).length > 0);
    }
  });

  it("使用 NFKC 与兼容 casefold", () => {
    expect(normalize_literal_text("ＳＴＲＡẞＥ I ΟΣ", false)).toBe("strasse i οσ");
    expect(
      compile_literal_patterns([{ key: "term", text: "STRASSE", case_sensitive: false }]).match(
        "Straße",
      ),
    ).toEqual([{ key: "term", ranges: [{ start: 0, end: 6 }] }]);
  });

  it("大小写敏感规则仍执行 NFKC，但不执行大小写折叠", () => {
    const matcher = compile_literal_patterns([{ key: "term", text: "JK", case_sensitive: true }]);

    expect(matcher.match("ＪＫ")).toEqual([{ key: "term", ranges: [{ start: 0, end: 2 }] }]);
    expect(matcher.match("ｊｋ")).toEqual([]);
  });

  it("统一上下文大小写折叠，并合并字符展开产生的重复原文范围", () => {
    const matcher = compile_literal_patterns([
      { key: "sigma", text: "ΟΣ", case_sensitive: false },
      { key: "expanded", text: "s", case_sensitive: false },
    ]);

    expect(matcher.match("ΟΣ ος οσ ß")).toEqual([
      {
        key: "sigma",
        ranges: [
          { start: 0, end: 2 },
          { start: 3, end: 5 },
          { start: 6, end: 8 },
        ],
      },
      { key: "expanded", ranges: [{ start: 9, end: 10 }] },
    ]);
  });

  it("忽略空 pattern，并拒绝重复 key", () => {
    const empty_matcher = compile_literal_patterns([
      { key: "empty", text: "", case_sensitive: false },
    ]);
    expect(empty_matcher).toEqual(expect.objectContaining({ patterns: [] }));
    expect(empty_matcher.matches("任意文本")).toBe(false);
    expect(() =>
      compile_literal_patterns([
        { key: "same", text: "a", case_sensitive: true },
        { key: "same", text: "b", case_sensitive: false },
      ]),
    ).toThrow("Duplicate literal pattern key");
  });
});
