import { describe, expect, it } from "vitest";

import { type Item, create_item } from "../../../domain/item";
import { build_skeleton, scan_double_quoted_literals, sha1_hex } from "./lexer";
import type { RenpyBlockKind, RenpySlot } from "./types";
import { RenpyWriter } from "./writer";

describe("RenPy 写回器", () => {
  it("按 NAME 和 DIALOGUE 槽构造替换并按序号写入字面量", () => {
    const writer = new RenpyWriter(true);
    const item = create_item({ status: "PROCESSED", dst: "新台词", name_dst: "新名字" });
    const replacements = writer.build_replacements(
      item,
      [
        { role: "NAME", lit_index: 0 },
        { role: "DIALOGUE", lit_index: 1 },
      ],
      ["old_name", "old_line"],
    );

    expect([...replacements.entries()]).toEqual([
      [0, "新名字"],
      [1, "新台词"],
    ]);
    expect(writer.replace_literals_by_index('e "old_name" "old_line"', replacements)).toBe(
      'e "新名字" "新台词"',
    );
  });

  it("禁用姓名译名写回时用源姓名替换 NAME 槽", () => {
    const writer = new RenpyWriter(false);
    const item = create_item({
      status: "PROCESSED",
      dst: "新台词",
      name_src: "原名",
      name_dst: "译名",
    });
    const replacements = writer.build_replacements(
      item,
      [
        { role: "NAME", lit_index: 0 },
        { role: "DIALOGUE", lit_index: 1 },
      ],
      ["old_name", "old_line"],
    );

    expect([...replacements.entries()]).toEqual([
      [0, "原名"],
      [1, "新台词"],
    ]);
  });

  it("LABEL 写回使用模板代码并保留 PushMove 尾随字符串", () => {
    const writer = new RenpyWriter(true);
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
    const writer = new RenpyWriter(true);
    const lines = ['    # "old text" (cb_name="mr")', '    "old text" (cb_name="mr")'];
    const item = build_apply_item(lines, {
      dst: "new text",
      slots: [{ role: "DIALOGUE", lit_index: 0 }],
    });

    expect(writer.apply_item(lines, item)).toBe(true);
    expect(lines[1]).toBe('    "new text" (cb_name="mr")');
  });

  it("STRINGS 写回在目标 new 行上替换 STRING 槽", () => {
    const writer = new RenpyWriter(true);
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
    const writer = new RenpyWriter(true);
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
    // 定位元数据可能来自旧工程，超出源目标字面量范围的槽位应跳过。
    const out_of_range = build_apply_item(lines, {
      dst: "new",
      slots: [{ role: "DIALOGUE", lit_index: 1 }],
    });
    expect(writer.apply_item(lines.slice(), out_of_range)).toBe(false);
    expect(
      writer.apply_item(
        lines.slice(),
        create_item({
          status: "PROCESSED",
          dst: "new",
          extra_field: { renpy: { pair: [], digest: {} } },
        }),
      ),
    ).toBe(false);
  });

  it("批量写回只修改通过原稿校验的条目", () => {
    const writer = new RenpyWriter(true);
    const lines = ['    # e "old"', '    e "old"'];
    const ok = build_apply_item(lines, {
      dst: "new",
      slots: [{ role: "DIALOGUE", lit_index: 0 }],
    });
    const bad = create_item({ status: "PROCESSED", dst: "new", extra_field: "" });

    writer.apply_items_to_lines(lines, [ok, bad]);
    expect(lines).toEqual(['    # e "old"', '    e "new"']);
  });
});

it("同值源码保持原切片，正文与姓名编辑采用普通字符串编码", () => {
  const writer = new RenpyWriter(true);
  const code = String.raw`"A\'B" r"a  \n"`;
  expect(
    writer.replace_literals_by_index(
      code,
      new Map([
        [0, "A'B"],
        [1, String.raw`a  \n`],
      ]),
    ),
  ).toBe(code);
  const changed = writer.replace_literals_by_index(
    code,
    new Map([
      [0, "新'名"],
      [1, "a  b\n"],
    ]),
  );
  expect(
    scan_double_quoted_literals(changed).map((literal) => [literal.raw, literal.value]),
  ).toEqual([
    [false, "新'名"],
    [false, "a  b\n"],
  ]);
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
  return create_item({
    status: "PROCESSED",
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

it.each(["", "已有译文"])("未完成 Ren’Py 正文回退源目标 %j，完成空正文直接清空", (source) => {
  const writer = new RenpyWriter(true);
  const lines = ['    old "old"', `    new "${source}"`];
  const item = build_apply_item(lines, {
    kind: "STRINGS",
    dst: "暂存译文",
    slots: [{ role: "STRING", lit_index: 0 }],
  });
  item.status = "ERROR";
  writer.apply_item(lines, item);
  expect(lines[1]).toBe(`    new "${source || "old"}"`);
  item.status = "PROCESSED";
  item.dst = "";
  writer.apply_item(lines, item);
  expect(lines[1]).toBe('    new ""');
});
