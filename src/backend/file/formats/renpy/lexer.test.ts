import { describe, expect, it } from "vitest";

import {
  build_skeleton,
  escape_renpy_string,
  is_translatable_text,
  looks_like_resource_path,
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
    expect(looks_like_resource_path("bg/scene.PNG")).toBe(true);
    expect(looks_like_resource_path("{image=gui/icon.png}")).toBe(false);
    expect(
      ["[player_name]", "{b}{/b}", "{#language name and font}", "{image=gui/icon.png}"].map(
        is_translatable_text,
      ),
    ).toEqual([false, false, true, true]);
  });
});
