import { expect, it } from "vitest";
import { WolfReader, encode_wolf_string } from "./binary";

it("CP932 和 UTF-8 保留空文本、换行和控制符，不可编码字符明确失败", () => {
  for (const utf8 of [false, true])
    for (const text of ["", "日本語\n\\cdb[0:1:2]", ...(utf8 ? ["𠮷"] : [])]) {
      const reader = new WolfReader(encode_wolf_string(text, utf8), 0, utf8);
      expect(reader.string()).toBe(text);
      reader.done();
    }
  expect(() => encode_wolf_string("𠮷", false)).toThrow("CP932");
  expect(() => new WolfReader(Buffer.from([2, 0, 0, 0, 65])).string()).toThrow("Truncated");
  expect(() => new WolfReader(Buffer.from([1, 0, 0, 0, 65])).string()).toThrow("Unterminated");
});
