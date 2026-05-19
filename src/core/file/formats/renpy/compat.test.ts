import { describe, expect, it } from "vitest";

import { Item } from "../../../../base/item";
import { sha1_hex } from "./lexer";
import {
  build_ast_keys,
  build_items_for_writeback,
  has_current_ast_extra_field,
  pick_best_candidate,
  transfer_legacy_translations,
} from "./compat";

describe("RenPy 兼容层", () => {
  it("识别当前 AST extra 并构造主摘要与去行尾空白摘要键", () => {
    const item = make_ast_item({
      digest: "a",
      fallback_digest: "b",
      target_line: 4,
      dst: "你好",
    });

    expect(has_current_ast_extra_field(item)).toBe(true);
    expect(build_ast_keys(item)).toEqual([
      ["schinese", "start", "a"],
      ["schinese", "start", "b"],
    ]);
  });

  it("旧 AST extra 缺少版本时重解析原文件并迁移译文", () => {
    const lines = build_lines();
    const legacy_ast = make_ast_item({
      digest: sha1_hex('    # e "Hello"'),
      target_line: 4,
      dst: "你好",
      with_version: false,
    });

    const [rebuilt] = build_items_for_writeback("script.rpy", lines, [legacy_ast]);

    expect(rebuilt?.dst).toBe("你好");
    expect(has_current_ast_extra_field(rebuilt!)).toBe(true);
  });

  it("历史字符串 extra 只迁移译文，不直接驱动写回", () => {
    const lines = build_lines();
    const legacy_items = [
      Item.from_json({ row: 1, extra_field: "translate schinese start:" }),
      Item.from_json({
        row: 3,
        src: "Hello",
        dst: "你好",
        name_dst: "艾丽丝",
        extra_field: '    # e "Hello"',
      }),
    ];

    const [rebuilt] = build_items_for_writeback("script.rpy", lines, legacy_items);

    expect(rebuilt).toEqual(
      expect.objectContaining({
        src: "Hello",
        dst: "你好",
        name_dst: "艾丽丝",
      }),
    );
  });

  it("AST 迁移命中的目标行会阻止历史译文覆盖", () => {
    const lines = build_lines();
    const current = make_ast_item({
      digest: sha1_hex('    # e "Hello"'),
      target_line: 4,
      dst: "当前译文",
    });
    const legacy = Item.from_json({
      row: 3,
      src: "Hello",
      dst: "旧译文",
      extra_field: '    # e "Hello"',
    });
    const header = Item.from_json({ row: 1, extra_field: "translate schinese start:" });

    const [rebuilt] = build_items_for_writeback("script.rpy", lines, [header, current, legacy]);

    expect(rebuilt?.dst).toBe("当前译文");
  });

  it("无法匹配历史候选时保留重新解析出的目标文本", () => {
    const item = make_ast_item({
      digest: "missing",
      target_line: 4,
      dst: "",
    });

    transfer_legacy_translations(
      [
        Item.from_json({ row: 1, extra_field: "translate schinese start:" }),
        Item.from_json({ row: 3, src: "Other", dst: "别的", extra_field: '    # e "Other"' }),
      ],
      [item],
      null,
    );

    expect(item.dst).toBe("");
  });

  it("候选选择优先匹配原文和姓名，其次匹配原文", () => {
    const item = Item.from_json({ src: "Hello", name_src: "Alice" });
    const candidates = [
      Item.from_json({ src: "Hello", name_src: "Bob", dst: "鲍勃" }),
      Item.from_json({ src: "Hello", name_src: "Alice", dst: "艾丽丝" }),
    ];

    expect(pick_best_candidate(item, candidates).dst).toBe("艾丽丝");
    expect(candidates).toHaveLength(1);
  });
});

/**
 * 统一历史迁移样本，避免各用例手写行号后失配。
 */
function build_lines(): string[] {
  return ["translate schinese start:", "", '    # e "Hello"', '    e ""'];
}

/**
 * 构造最小 AST extra，用于覆盖当前与旧 AST 两条兼容路径。
 */
function make_ast_item(options: {
  digest: string;
  fallback_digest?: string;
  target_line: number;
  dst: string;
  with_version?: boolean;
}): Item {
  const renpy: Record<string, unknown> = {
    block: { lang: "schinese", label: "start", kind: "LABEL", header_line: 1 },
    pair: { template_line: 3, target_line: options.target_line },
    slots: [{ role: "DIALOGUE", lit_index: 0 }],
    digest: {
      template_raw_sha1: options.digest,
      template_raw_rstrip_sha1: options.fallback_digest ?? options.digest,
      target_skeleton_sha1: "unused",
      target_string_count: 1,
    },
  };
  if (options.with_version !== false) {
    renpy["v"] = 1;
  }
  return Item.from_json({
    src: "Hello",
    dst: options.dst,
    extra_field: { renpy },
  });
}
