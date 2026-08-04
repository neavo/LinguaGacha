import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  check_similarity_by_jaccard,
  decode_text_content,
  is_punctuation_character,
  split_by_punctuation,
} from "./text-tool";

const { chardet_detect_mock } = vi.hoisted(() => {
  return {
    chardet_detect_mock: vi.fn(),
  };
});

vi.mock("chardet", () => {
  return {
    detect: chardet_detect_mock,
  };
});

describe("文本工具", () => {
  beforeEach(() => {
    chardet_detect_mock.mockReset();
  });

  it.each([
    ["。", true],
    ["♥", true],
    ["A", false],
    ["你", false],
  ] as const)("按 Unicode 标点/符号口径判断字符 %s", (char, expected) => {
    expect(is_punctuation_character(char)).toBe(expected);
  });

  it.each([
    ["A,B.C", false, ["A", "B", "C"]],
    ["A B，C\u3000D", true, ["A", "B", "C", "D"]],
    ["，， !! \u3000", true, []],
  ] as const)("按标点和可选空格切分文本 %#", (text, split_by_space, expected) => {
    expect(split_by_punctuation(text, split_by_space)).toEqual(expected);
  });

  it.each([
    ["abc", "abc", 1.0],
    ["abc", "def", 0.0],
    ["ab", "bc", 1 / 3],
    ["", "", 0.0],
  ] as const)("计算字符集合 Jaccard 相似度 %#", (left, right, expected) => {
    expect(check_similarity_by_jaccard(left, right)).toBeCloseTo(expected);
  });

  it("解码 UTF-8 BOM 文本", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("hello")]);
    await expect(decode_text_content(bytes)).resolves.toBe("hello");
  });

  it("按探测结果解码非 UTF-8 文本", async () => {
    chardet_detect_mock.mockReturnValue("windows-1252");

    await expect(decode_text_content(new Uint8Array([0xe9]))).resolves.toBe("é");
  });

  it("声明编码优先于自动探测", async () => {
    chardet_detect_mock.mockReturnValue("utf-8");

    await expect(
      decode_text_content(new Uint8Array([0xe9]), { declaredEncoding: "windows-1252" }),
    ).resolves.toBe("é");
    expect(chardet_detect_mock).not.toHaveBeenCalled();
  });

  it("声明编码不受支持时继续使用探测结果", async () => {
    chardet_detect_mock.mockReturnValue("windows-1252");

    await expect(
      decode_text_content(new Uint8Array([0xe9]), { declaredEncoding: "unsupported" }),
    ).resolves.toBe("é");
  });

  it("编码探测异常时回退默认 UTF-8 解码", async () => {
    chardet_detect_mock.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(decode_text_content(new Uint8Array([0x68, 0x65]))).resolves.toBe("he");
  });
});
