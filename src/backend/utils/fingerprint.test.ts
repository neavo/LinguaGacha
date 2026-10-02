import { expect, it } from "vitest";
import { fingerprint } from "./fingerprint";

// 固定向量独立于实现，锁定完整 SHA-256 摘要的低位 Base62 编码。
it.each([
  ["", 4, "LxI5"],
  ["abc", 1, "v"],
  ["搭档🙂", 4, "pgvC"],
  ["6", 4, "0KiR"],
  ["abc", 45, "00iDUK5mbjE0q8kxKur8d0acwb3mlMY7nzH5i6WpR5bav"],
] as const)("内容 %s 按 %i 位输出固定指纹", (content, length, expected) => {
  expect(fingerprint(content, length)).toBe(expected);
  expect(fingerprint(new TextEncoder().encode(content), length)).toBe(expected);
});

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("拒绝无效长度 %s", (length) =>
  expect(() => fingerprint("abc", length)).toThrow(RangeError),
);
