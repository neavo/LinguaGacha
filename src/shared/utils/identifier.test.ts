import { afterEach, expect, it, vi } from "vitest";
import { random_id } from "./identifier";

afterEach(() => vi.restoreAllMocks());

it("默认生成 8 位 Base36 标识", () => {
  expect(random_id()).toMatch(/^[0-9a-z]{8}$/u);
});

it("跨越随机字节单批上限时补足指定长度", () => {
  const id = random_id(65_537);
  expect(id).toHaveLength(65_537);
  expect(id).toMatch(/^[0-9a-z]+$/u);
});

it("接受 0 到 251，拒绝 252 到 255 并补足长度", () => {
  const batches = [
    [0, 9, 10, 35, 36, 251, 252, 253, 254, 255],
    [0, 9, 10, 35],
  ];
  vi.spyOn(crypto, "getRandomValues").mockImplementation(((bytes: Uint8Array) => {
    bytes.set(batches.shift()!);
    return bytes;
  }) as typeof crypto.getRandomValues);
  expect(random_id(10)).toBe("09az0z09az");
});

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("拒绝无效长度 %s", (length) => {
  expect(() => random_id(length)).toThrow(RangeError);
});
