import { expect, it } from "vitest";
import { decompress_aplib } from "./aplib";

// Sandor Nemes aplib 自测公开向量，预期明文不依赖本项目编码器。
const PACKED = Buffer.from(
  "5400686520717569636bec620e726f776ece66ae78806a756d7073ede47665757260743f6c617a79ea64fe67c000",
  "hex",
);
it("aPLib 独立向量与截断、输出越界校验", () => {
  expect(decompress_aplib(PACKED, 43).toString()).toBe(
    "The quick brown fox jumps over the lazy dog",
  );
  for (let size = 0; size < PACKED.length; size++)
    expect(() => decompress_aplib(PACKED.subarray(0, size), 43)).toThrow();
  expect(() => decompress_aplib(PACKED, 42)).toThrow();
  expect(() => decompress_aplib(Buffer.from([65, 0xc0, 0xff]), 43)).toThrow();
});
