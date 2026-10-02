import { afterEach, expect, it, vi } from "vitest";
import { base62_pattern, random_id } from "./base62";

afterEach(() => vi.restoreAllMocks());

it.each([1, 65_537])("生成恰好 %i 位的 Base62 标识", (length) => {
  const id = random_id(length);
  expect(id).toHaveLength(length);
  expect(id).toMatch(/^[0-9A-Za-z]+$/u);
});

it("接受 0 到 247，拒绝 248 到 255 并补足长度", () => {
  const batches = [
    [0, 9, 10, 35, 36, 61, 62, 247, 248, 249, 250, 251, 252, 253, 254, 255],
    [0, 9, 10, 35, 36, 61, 62, 247],
  ];
  vi.spyOn(crypto, "getRandomValues").mockImplementation(((bytes: Uint8Array) => {
    bytes.set(batches.shift()!);
    return bytes;
  }) as typeof crypto.getRandomValues);
  expect(random_id(16)).toBe("09AZaz0z09AZaz0z");
});

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("拒绝无效长度 %s", (length) => {
  expect(() => random_id(length)).toThrow(RangeError);
  expect(() => base62_pattern(length)).toThrow(RangeError);
});

it("格式规则严格匹配整串 Base62", () => {
  const pattern = base62_pattern(4);
  for (const value of ["09AZ", "azIO", "lO01"]) expect(pattern.test(value)).toBe(true);
  for (const value of ["", "abc", "abcde", "ab-_", "a/bc", "中文AB", "abcd\n"]) {
    expect(pattern.test(value)).toBe(false);
  }
});
