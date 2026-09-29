import { describe, expect, it } from "vitest";

import {
  find_character_name_lit_index,
  find_dialogue_string_group,
  match_template_to_target,
  pair_old_new,
  statements_equal,
} from "./matcher";
import { parse_document, parse_statement } from "./parser";

describe("RenPy matcher", () => {
  it("忽略 Character 字面量中的括号和对白后的函数参数", () => {
    const template = parse_statement(1, '    # Character(")") "Hello" with PushMove("x")', "LABEL");
    const target = parse_statement(2, '    Character(")") "你好" with PushMove("y")', "LABEL");
    const name_index = find_character_name_lit_index(template);

    expect(name_index).toBe(0);
    expect(find_dialogue_string_group(template, name_index)).toEqual([1]);
    expect(statements_equal(template, target)).toBe(true);
  });

  it("label 用稳定顺序匹配，strings 只配对最后一个待定 old", () => {
    const document = parse_document([
      "translate schinese start:",
      '    # e "A"',
      '    unrelated "x"',
      '    e "甲"',
      '    # f "B"',
      '    f "乙"',
      "translate schinese strings:",
      '    old "A"',
      '    old "B"',
      '    new "乙"',
    ]);

    expect([...match_template_to_target(document.blocks[0]!).entries()]).toEqual([
      [2, 4],
      [5, 6],
    ]);
    expect([...pair_old_new(document.blocks[1]!).entries()]).toEqual([[9, 10]]);
  });
});
