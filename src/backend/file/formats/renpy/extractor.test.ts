import { describe, expect, it } from "vitest";

import type { Item } from "../../../../domain/item";
import { RenpyExtractor } from "./extractor";
import { parse_document } from "./parser";

describe("RenPy extractor", () => {
  it("把 strings 与 label 配对转换为稳定项目条目", () => {
    const items = extract([
      "translate schinese strings:",
      '    old "START"',
      '    new "开始"',
      "translate schinese start:",
      '    # "Alice" "Hello"',
      '    "爱丽丝" "你好"',
    ]);

    expect(items).toEqual([
      expect.objectContaining({ src: "START", dst: "开始", row: 2, status: "PROCESSED" }),
      expect.objectContaining({
        src: "Hello",
        dst: "你好",
        name_src: "Alice",
        name_dst: "爱丽丝",
        row: 5,
        status: "PROCESSED",
      }),
    ]);
    expect(items[1]?.extra_field).toMatchObject({
      renpy: {
        pair: { template_line: 5, target_line: 6 },
        slots: [
          { role: "NAME", lit_index: 0 },
          { role: "DIALOGUE", lit_index: 1 },
        ],
      },
    });
  });

  it("Character 参数与尾随字符串不会混入姓名和对白槽", () => {
    const [item] = extract([
      "translate schinese start:",
      '    # Character("Man") "Hello" (cb_name="mr")',
      '    Character("Man") "你好" (cb_name="卡雷")',
    ]);

    expect(item).toEqual(
      expect.objectContaining({
        name_src: "Man",
        name_dst: null,
        src: "Hello",
        dst: "你好",
      }),
    );
  });

  it("完整资源引用不生成 Item，带正文的引用仍保留", () => {
    const items = extract([
      "translate schinese strings:",
      '    old "https://example.com/guide"',
      '    new ""',
      '    old "请看 https://example.com/guide"',
      '    new ""',
    ]);

    expect(items.map((item) => item.src)).toEqual(["请看 https://example.com/guide"]);
  });
});

function extract(lines: string[]): Item[] {
  return new RenpyExtractor().extract(parse_document(lines), "script.rpy");
}
