import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TextTool } from "./text-tool";

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

describe("TextTool", () => {
  beforeEach(() => {
    chardet_detect_mock.mockReset();
  });

  it.each([
    ["。", true],
    ["!", true],
    ["·", true],
    ["A", false],
  ] as const)("按历史 TextHelper 口径判断标点 %s", (char, expected) => {
    expect(TextTool.is_punctuation_character(char)).toBe(expected);
  });

  it("按标点类型分别判断字符", () => {
    expect(TextTool.is_cjk_punctuation_character("。")).toBe(true);
    expect(TextTool.is_latin_punctuation_character("!")).toBe(true);
    expect(TextTool.is_special_punctuation_character("♥")).toBe(true);
    expect(TextTool.is_special_punctuation_character("。")).toBe(false);
  });

  it("判断文本中是否包含任意标点或全部为标点", () => {
    expect(TextTool.any_punctuation("A, B")).toBe(true);
    expect(TextTool.all_punctuation("!?")).toBe(true);
    expect(TextTool.all_punctuation("")).toBe(true);
  });

  it("移除首尾标点并保留中间内容", () => {
    expect(TextTool.strip_punctuation("  ...你好！！  ")).toBe("你好");
    expect(TextTool.strip_punctuation("...！！")).toBe("");
  });

  it("空白文本移除首尾标点后返回空字符串", () => {
    expect(TextTool.strip_punctuation("   ")).toBe("");
  });

  it("只移除首尾阿拉伯数字", () => {
    expect(TextTool.strip_arabic_numerals("123abc456")).toBe("abc");
    expect(TextTool.strip_arabic_numerals("abc123def")).toBe("abc123def");
  });

  it.each([
    ["A,B.C", false, ["A", "B", "C"]],
    ["A B，C\u3000D", true, ["A", "B", "C", "D"]],
    ["，，A,,B！！", false, ["A", "B"]],
    ["，， !! \u3000", true, []],
  ] as const)("按标点和可选空格切分文本 %#", (text, split_by_space, expected) => {
    expect(TextTool.split_by_punctuation(text, split_by_space)).toEqual(expected);
  });

  it.each([
    ["abc", "abc", 1.0],
    ["abc", "def", 0.0],
    ["ab", "bc", 1 / 3],
    ["", "", 0.0],
  ] as const)("计算字符集合 Jaccard 相似度 %#", (left, right, expected) => {
    expect(TextTool.check_similarity_by_jaccard(left, right)).toBeCloseTo(expected);
  });

  it.each([
    ["abc", 3],
    ["你好", 4],
    ["a你", 3],
  ] as const)("计算文本显示长度 %#", (text, expected) => {
    expect(TextTool.get_display_length(text)).toBe(expected);
  });

  it("解码 UTF-8 BOM 文本", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("hello")]);
    await expect(TextTool.decode(bytes)).resolves.toBe("hello");
  });

  it.each([
    ["ascii", true, "utf-8-sig"],
    ["utf_8", false, "utf_8"],
    ["gbk", true, "gbk"],
  ] as const)("归一化编码探测结果 %#", async (detected, add_sig_to_utf8, expected) => {
    chardet_detect_mock.mockReturnValue(detected);

    await expect(
      TextTool.get_encoding(null, new Uint8Array([0x68, 0x65]), add_sig_to_utf8),
    ).resolves.toBe(expected);
  });

  it("编码探测异常时回退默认 UTF-8-SIG", async () => {
    chardet_detect_mock.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(TextTool.get_encoding(null, new Uint8Array([0x68, 0x65]))).resolves.toBe(
      "utf-8-sig",
    );
  });

  it("编码探测无结果时回退默认 UTF-8-SIG", async () => {
    chardet_detect_mock.mockReturnValue(null);

    await expect(TextTool.get_encoding(null, new Uint8Array([0x68, 0x65]))).resolves.toBe(
      "utf-8-sig",
    );
  });

  it("同时传入路径和内容时优先使用路径内容探测编码", async () => {
    const temp_dir = await mkdtemp(join(tmpdir(), "linguagacha-text-tool-"));
    try {
      const path = join(temp_dir, "dummy.txt");
      await writeFile(path, new Uint8Array([0x01]));
      chardet_detect_mock.mockImplementation((content: Uint8Array) => {
        return content[0] === 0x01 ? "utf-8" : "gbk";
      });

      await expect(TextTool.get_encoding(path, new Uint8Array([0x02]))).resolves.toBe("utf-8-sig");
    } finally {
      await rm(temp_dir, { force: true, recursive: true });
    }
  });

  it("路径内容探测无结果时回退默认 UTF-8-SIG", async () => {
    const temp_dir = await mkdtemp(join(tmpdir(), "linguagacha-text-tool-"));
    try {
      const path = join(temp_dir, "dummy.txt");
      await writeFile(path, new Uint8Array([0x68, 0x65]));
      chardet_detect_mock.mockReturnValue(null);

      await expect(TextTool.get_encoding(path)).resolves.toBe("utf-8-sig");
    } finally {
      await rm(temp_dir, { force: true, recursive: true });
    }
  });

  it("没有输入时使用默认 UTF-8-SIG", async () => {
    await expect(TextTool.get_encoding(null, null)).resolves.toBe("utf-8-sig");
    expect(chardet_detect_mock).not.toHaveBeenCalled();
  });
});
