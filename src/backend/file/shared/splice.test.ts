import { expect, it } from "vitest";
import { splice } from "./splice";
it("按原稿拼接插入和替换，保留未修改区间并拒绝重叠或非法范围", () => {
  const original = Buffer.from("abcdef");
  expect(
    splice(original, [
      { start: 4, end: 5, bytes: Buffer.from("E") },
      { start: 1, end: 2, bytes: Buffer.from("B") },
      { start: 1, end: 1, bytes: Buffer.from("+") },
    ]).toString(),
  ).toBe("a+BcdEf");
  for (const [start, end] of [
    [0, 2],
    [1.5, 2],
    [-1, 0],
    [4, 7],
    [4, 3],
  ])
    expect(() =>
      splice(original, [
        { start: 1, end: 2, bytes: Buffer.from("B") },
        { start: start!, end: end!, bytes: Buffer.alloc(0) },
      ]),
    ).toThrow();
});
