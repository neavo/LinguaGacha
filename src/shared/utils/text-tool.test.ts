import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  check_similarity_by_jaccard,
  decode_text_content,
  is_punctuation_character,
  iterate_utf8_lf_lines,
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

  it.each([
    ["UTF-8", [0xef, 0xbb, 0xbf, 0x68, 0x69]],
    ["UTF-16LE", [0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]],
    ["UTF-16BE", [0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]],
    ["UTF-32LE", [0xff, 0xfe, 0x00, 0x00, 0x68, 0x00, 0x00, 0x00, 0x69, 0x00, 0x00, 0x00]],
    ["UTF-32BE", [0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x68, 0x00, 0x00, 0x00, 0x69]],
  ] as const)("按 %s BOM 解码文本", async (_encoding, bytes) => {
    await expect(decode_text_content(new Uint8Array(bytes))).resolves.toBe("hi");
  });

  it("合法 UTF-8 直接解码且不执行编码探测", async () => {
    const bytes = new TextEncoder().encode("魔女");

    await expect(decode_text_content(bytes)).resolves.toBe("魔女");
    expect(chardet_detect_mock).not.toHaveBeenCalled();
  });

  it("LF 流式分行保留 Unicode 行分隔符并兼容 CRLF", async () => {
    const content = new TextEncoder().encode("甲\u2028乙\r\n丙\u2029丁\n尾");
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield content.slice(0, 1);
      yield content.slice(1, 7);
      yield content.slice(7);
    }
    const lines: string[] = [];
    for await (const line of iterate_utf8_lf_lines(chunks())) lines.push(line);

    expect(lines).toEqual(["甲\u2028乙", "丙\u2029丁", "尾"]);
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

  it("声明 UTF-8 时拒绝非法字节", async () => {
    await expect(
      decode_text_content(new Uint8Array([0xe9]), { declaredEncoding: "utf-8" }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("BOM 优先于调用方声明编码", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]);

    await expect(decode_text_content(bytes, { declaredEncoding: "windows-1252" })).resolves.toBe(
      "hi",
    );
  });

  it("声明编码不受支持时继续严格判断 UTF-8", async () => {
    const bytes = new TextEncoder().encode("hello");

    await expect(decode_text_content(bytes, { declaredEncoding: "unsupported" })).resolves.toBe(
      "hello",
    );
  });

  it("编码探测异常时保留原始错误", async () => {
    const error = new Error("boom");
    chardet_detect_mock.mockImplementation(() => {
      throw error;
    });

    await expect(decode_text_content(new Uint8Array([0xe9]))).rejects.toBe(error);
  });

  it.each([null, "unsupported"] as const)(
    "传统编码探测结果 %s 无法解码时明确失败",
    async (detected_encoding) => {
      chardet_detect_mock.mockReturnValue(detected_encoding);

      await expect(decode_text_content(new Uint8Array([0xe9]))).rejects.toBeInstanceOf(TypeError);
    },
  );
});
