import path from "node:path";
import { expect, it } from "vitest";
import { encode_python, decode_python, paragraph_text } from "./python";
import { configure_python_parser, PythonSession } from "./python-syntax";

configure_python_parser(path.resolve("build/resources/workspace"));

it.each([
  ["A  B", "A  B"],
  ["A{p}\nB", "A{p}B"],
  ["A{p=1.0}\n B", "A{p=1.0}B"],
  ["\n A\n B\n\n C\n", "A B\n\nC"],
  ["\n\nA\n\n", "\n\nA\n\n"],
])("_p 段落语义：%j", (source, expected) => {
  expect(paragraph_text(source!)).toBe(expected);
});
it.each(['中文🙂 "quote" \\', "first\nsecond\tline", "{#context} [a[0]] 25%", "\x07\b\f\r"])(
  "Unicode 编码往返：%s",
  async (text) => {
    using session = await PythonSession.create();
    expect(
      (await session.analyze({ source: encode_python(text), mode: "eval" })).constants[0]?.value,
    ).toBe(text);
  },
);
it.each([
  ["", "\\xe7", true],
  ["", "\\u0061", true],
  ["ur", "\\u0061", false],
  ["u", "\\N{LATIN SMALL LETTER A}", false],
])("不确定或未支持的字面量明确失败：%s %s", (prefix, body, python2) => {
  expect(() =>
    decode_python({ prefix: String(prefix), body: String(body) }, Boolean(python2)),
  ).toThrow();
});
