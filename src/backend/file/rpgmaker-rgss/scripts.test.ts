import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { read_rgss_script } from "./scripts";
import { write_text } from "./value";

it.each(["utf8", "cp932"])("%s 脚本先解压再按编码声明读取", (encoding) => {
  const source = `# coding: ${encoding}\nputs "選択"\n`;
  expect(read_rgss_script({ t: '"', data: deflateSync(write_text(source, encoding)) })).toEqual({
    source,
    encoding,
  });
});

it("脚本解压仍拒绝超过现有大小边界的载荷", () => {
  const oversized = deflateSync(Buffer.alloc(32 * 1024 * 1024 + 1));
  expect(() => read_rgss_script({ t: '"', data: oversized })).toThrow();
});
