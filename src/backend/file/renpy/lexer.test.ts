import { describe, expect, it } from "vitest";

import {
  build_skeleton,
  escape_renpy_string,
  unescape_renpy_string,
  is_translatable_text,
  looks_like_resource_reference,
  scan_double_quoted_literals,
} from "./lexer";

describe("RenPy lexer", () => {
  it("扫描转义字面量并生成稳定语句骨架", () => {
    const code = 'Character("A\\"B") "line\\nnext" with PushMove("x")';
    const literals = scan_double_quoted_literals(code);

    expect(literals.map((literal) => literal.value)).toEqual(['A"B', "line\nnext", "x"]);
    expect(build_skeleton(code, literals)).toBe('Character("{}") "{}" with PushMove("{}")');
    expect(escape_renpy_string('A\\B"\n')).toBe('A\\\\B\\"\\n');
  });

  it("区分资源、占位和 RenPy 官方可翻译标记", () => {
    expect(looks_like_resource_reference("bg/scene.PNG")).toBe(true);
    expect(looks_like_resource_reference("https://example.com/scene")).toBe(true);
    expect(looks_like_resource_reference("{image=gui/icon.png}")).toBe(false);
    expect(
      ["[player_name]", "{b}{/b}", "{#language name and font}", "{image=gui/icon.png}"].map(
        is_translatable_text,
      ),
    ).toEqual([false, false, true, true]);
  });
});

it("按 Ren’Py 语义解码转义，每个序列只消费一次", () => {
  const cases = [
    [String.raw`\'`, "'"],
    [String.raw`\\n`, String.raw`\n`],
    [String.raw`\n`, "\n"],
    [String.raw`\[name]\{i}\%`, "[[name]{{i}%%"],
    [String.raw`\u41\u0042`, "AB"],
    [String.raw`\q`, "q"],
    ["a   b", "a b"],
    [String.raw`a \  b`, "a  b"],
  ];
  for (const [source, expected] of cases) expect(unescape_renpy_string(source!)).toBe(expected);
  expect(() => unescape_renpy_string(String.raw`\u`)).toThrow(SyntaxError);
});

it("编码保留空值、反斜杠、连续空白、控制字符和文本标记", () => {
  for (const text of [
    "",
    String.raw`\n`,
    "'\"\\",
    "a   b",
    " \n\r\t\b\f\v\u0000\u001c\u0085\u2028\u2029 ",
    "{{字面}} [[字面] %% [name] {i}Unicode🌸{/i}",
  ]) {
    expect(unescape_renpy_string(escape_renpy_string(text))).toBe(text);
  }
  expect(escape_renpy_string("a  b\r")).toBe(String.raw`a \ b\u000d`);
});

it("原始字符串保留转义与空白，骨架保留前缀，未闭合引号拒绝扫描", () => {
  const code = String.raw`e r"a  \n"`;
  const [literal] = scan_double_quoted_literals(code);
  expect(literal).toMatchObject({
    start_col: 2,
    end_col: code.length,
    raw: true,
    value: String.raw`a  \n`,
  });
  expect(build_skeleton(code)).toBe('e r"{}"');
  expect(scan_double_quoted_literals(String.raw`e "trailing\"`)).toEqual([]);
});
