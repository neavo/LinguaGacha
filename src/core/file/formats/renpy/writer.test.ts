import { describe, expect, it } from "vitest";

import { Item } from "../../../../domain/item";
import { build_skeleton, scan_double_quoted_literals, sha1_hex } from "./lexer";
import type { RenpyBlockKind, RenpySlot } from "./types";
import { RenpyWriter } from "./writer";

describe("RenPy 写回器", () => {
  it("按 NAME 和 DIALOGUE 槽构造替换并按序号写入字面量", () => {
    const writer = new RenpyWriter();
    const item = Item.from_json({ dst: "新台词", name_dst: "新名字" });
    const replacements = writer.build_replacements(item, [
      { role: "NAME", lit_index: 0 },
      { role: "DIALOGUE", lit_index: 1 },
    ]);

    expect([...replacements.entries()]).toEqual([
      [0, "新名字"],
      [1, "新台词"],
    ]);
    expect(writer.replace_literals_by_index('e "old_name" "old_line"', replacements)).toBe(
      'e "新名字" "新台词"',
    );
  });

  it("LABEL 写回使用模板代码并保留 PushMove 尾随字符串", () => {
    const writer = new RenpyWriter();
    const lines = ['    # "Man" "old" with PushMove("x")', '    "Man" "" with PushMove("x")'];
    const item = build_apply_item(lines, {
      dst: "new",
      name_dst: "",
      slots: [
        { role: "NAME", lit_index: 0 },
        { role: "DIALOGUE", lit_index: 1 },
      ],
    });

    expect(writer.apply_item(lines, item)).toBe(true);
    expect(lines[1]).toBe('    "Man" "new" with PushMove("x")');
  });

  it("LABEL 写回只替换 cb_name 前的对白字符串", () => {
    const writer = new RenpyWriter();
    const lines = ['    # "old text" (cb_name="mr")', '    "old text" (cb_name="mr")'];
    const item = build_apply_item(lines, {
      dst: "new text",
      slots: [{ role: "DIALOGUE", lit_index: 0 }],
    });

    expect(writer.apply_item(lines, item)).toBe(true);
    expect(lines[1]).toBe('    "new text" (cb_name="mr")');
  });

  it("STRINGS 写回在目标 new 行上替换 STRING 槽", () => {
    const writer = new RenpyWriter();
    const lines = ['    old "START"', '    new ""'];
    const item = build_apply_item(lines, {
      kind: "STRINGS",
      dst: "开始",
      slots: [{ role: "STRING", lit_index: 0 }],
    });

    expect(writer.apply_item(lines, item)).toBe(true);
    expect(lines[1]).toBe('    new "开始"');
  });

  it("摘要或 extra_field 形状不合法时跳过写回", () => {
    const writer = new RenpyWriter();
    const lines = ['    # e "old"', '    e "old"'];
    const bad_digest = build_apply_item(lines, {
      dst: "new",
      slots: [{ role: "DIALOGUE", lit_index: 0 }],
    });
    const extra = bad_digest.extra_field as {
      renpy: { digest: { template_raw_sha1: string } };
    };
    extra.renpy.digest.template_raw_sha1 = "bad";

    expect(writer.apply_item(lines.slice(), bad_digest)).toBe(false);
    expect(
      writer.apply_item(
        lines.slice(),
        Item.from_json({ dst: "new", extra_field: { renpy: { pair: [], digest: {} } } }),
      ),
    ).toBe(false);
  });

  it("批量写回统计成功和跳过数量", () => {
    const writer = new RenpyWriter();
    const lines = ['    # e "old"', '    e "old"'];
    const ok = build_apply_item(lines, {
      dst: "new",
      slots: [{ role: "DIALOGUE", lit_index: 0 }],
    });
    const bad = Item.from_json({ dst: "new", extra_field: "" });

    expect(writer.apply_items_to_lines(lines, [ok, bad])).toEqual({ applied: 1, skipped: 1 });
  });
});

/**
 * 构造带有效摘要的测试条目，让写回器用真实校验路径执行。
 */
function build_apply_item(
  lines: string[],
  options: {
    kind?: RenpyBlockKind;
    dst: string;
    name_dst?: string;
    slots: RenpySlot[];
  },
): Item {
  const kind = options.kind ?? "LABEL";
  const target_rest = lines[1]?.replace(/^[ \t]+/u, "") ?? "";
  const target_literals = scan_double_quoted_literals(target_rest);
  return Item.from_json({
    src: "old",
    dst: options.dst,
    name_dst: options.name_dst ?? "新名字",
    extra_field: {
      renpy: {
        v: 1,
        block: {
          lang: "schinese",
          label: kind === "STRINGS" ? "strings" : "start",
          kind,
          header_line: 1,
        },
        pair: { template_line: 1, target_line: 2 },
        slots: options.slots,
        digest: {
          template_raw_sha1: sha1_hex(lines[0] ?? ""),
          template_raw_rstrip_sha1: sha1_hex((lines[0] ?? "").trimEnd()),
          target_skeleton_sha1: sha1_hex(build_skeleton(target_rest, target_literals)),
          target_string_count: target_literals.length,
        },
      },
    },
  });
}
