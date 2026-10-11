import { expect, it } from "vitest";
import iconv from "iconv-lite";
import { ruby_symbol, ruby_string } from "../../../test/rgss-fixture";
import { text, replace_text, read_text } from "./value";

it("显式 CP932 字符串保持编码，不能表示的译文明确失败", () => {
  const node = {
    t: "I",
    child: { t: '"', data: iconv.encode("日本語", "cp932") },
    pairs: [[ruby_symbol("encoding"), ruby_string("Windows-31J")]] as [
      ReturnType<typeof ruby_symbol>,
      ReturnType<typeof ruby_string>,
    ][],
  };
  expect(text(node)).toBe("日本語");
  const changed = replace_text(node, "中国語");
  expect(changed.child!.data).toEqual(iconv.encode("中国語", "cp932"));
  expect(text(changed)).toBe("中国語");
  expect(() => replace_text(node, "😀")).toThrow("cannot be encoded");
  expect(() => read_text(Buffer.from([255]))).toThrow("Invalid utf8");
});
