import { expect, it } from "vitest";
import { fastlz_decode } from "./fastlz";

it.each([1, 2])("FastLZ level %s 处理文字及重叠回引用，拒绝越界与截断", (level) => {
  const bytes = Buffer.from([((level - 1) << 5) | 2, 97, 98, 99, 32, 2]);
  expect(fastlz_decode(bytes, 6).toString()).toBe("abcabc");
  expect(() => fastlz_decode(bytes, 5)).toThrow();
  expect(() => fastlz_decode(bytes.subarray(0, -1), 6)).toThrow();
});
