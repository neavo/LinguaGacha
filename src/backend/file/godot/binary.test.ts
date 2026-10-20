import { expect, it } from "vitest";
import { Reader, splice } from "./binary";

it("有界读取拒绝负坐标、不安全 uint64 和截断，插入先于同坐标替换", () => {
  const reader = new Reader(Buffer.from([1, 2]));
  reader.at = -1;
  expect(() => reader.take(1)).toThrow();
  expect(() => new Reader(Buffer.alloc(1)).u32()).toThrow();
  const wide = Buffer.alloc(8);
  wide.writeBigUInt64LE(2n ** 63n);
  expect(() => new Reader(wide).u64()).toThrow();
  expect(
    splice(Buffer.from("abc"), [
      { start: 1, end: 2, bytes: Buffer.from("B") },
      { start: 1, end: 1, bytes: Buffer.from("+") },
    ]).toString(),
  ).toBe("a+Bc");
});
