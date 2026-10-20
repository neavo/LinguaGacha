import { expect, it } from "vitest";
import { compress_lz4, decompress_lz4 } from "./lz4";
import { wolf_literal } from "../../../test/wolf-fixture";

it.each([0, 1, 14, 15, 270, 65536, 131072])("LZ4 literal 和真实压缩均还原 %i 字节", (length) => {
  const bytes = Buffer.from(Array.from({ length }, (_, i) => i % 251));
  expect(decompress_lz4(wolf_literal(bytes), length).equals(bytes)).toBe(true);
  const packed = compress_lz4(bytes);
  expect(decompress_lz4(packed, length).equals(bytes)).toBe(true);
  if (length > 1000) expect(packed.length).toBeLessThan(length);
});
it("截断、零回溯、越界和长度不符均拒绝", () => {
  for (const bytes of [[0, 0, 0], [240], [0, 255, 255], [16], [1, 1, 0]])
    expect(() => decompress_lz4(Buffer.from(bytes), 8)).toThrow();
});
