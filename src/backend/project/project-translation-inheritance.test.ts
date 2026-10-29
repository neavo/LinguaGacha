import { describe, expect, it } from "vitest";

import type { TranslationInheritanceMode } from "../../shared/translation-inheritance";
import {
  inherit_completed_translations,
  type TranslationInheritanceItem,
} from "./project-translation-inheritance";

/** 默认构造未处理条目。 */
function item(
  file_path: string,
  src: string,
  overrides: Partial<TranslationInheritanceItem> = {},
): TranslationInheritanceItem {
  return { file_path, src, name_src: null, dst: "", name_dst: null, status: "NONE", ...overrides };
}

/** 构造可提供旧译文的已完成条目。 */
function done(file_path: string, src: string, dst: string): TranslationInheritanceItem {
  return item(file_path, src, { dst, status: "PROCESSED" });
}

/** 返回新条目继承后的译文与状态，便于整体比较。 */
function inherit(
  old_items: TranslationInheritanceItem[],
  next_items: TranslationInheritanceItem[],
  mode: TranslationInheritanceMode = "fill",
): Array<[string, string]> {
  inherit_completed_translations(old_items, next_items, mode);
  return next_items.map((next) => [next.dst, next.status]);
}

describe("inherit_completed_translations", () => {
  it("上下文一致时优先于不同的票选多数，并跨文件继承被过滤条目", () => {
    const old_items = [
      item("a.txt", "前"),
      done("a.txt", "EV1", "事件甲"),
      item("a.txt", "后"),
      done("b.txt", "EV1", "事件乙"),
      done("b.txt", "EV1", "事件乙"),
    ];

    expect(
      inherit(old_items, [
        item("new.txt", "前"),
        item("new.txt", "EV1", { status: "RULE_SKIPPED" }),
        item("new.txt", "后"),
        item("plain.txt", "前"),
        item("plain.txt", "EV1"),
        item("plain.txt", "后"),
        item("other.txt", "前"),
        item("other.txt", "EV1"),
        item("other.txt", "EV1", { status: "LANGUAGE_SKIPPED" }),
        item("other.txt", "尾"),
      ]),
    ).toEqual([
      ["", "NONE"],
      ["事件甲", "PROCESSED"],
      ["", "NONE"],
      ["", "NONE"],
      ["事件甲", "PROCESSED"], // 普通条目同样优先采用上下文结果。
      ["", "NONE"],
      ["", "NONE"],
      ["事件乙", "PROCESSED"],
      ["", "LANGUAGE_SKIPPED"],
      ["", "NONE"],
    ]);
  });

  it("上下文包含空正文邻居与文件边界，不跨文件串联", () => {
    const old_items = [
      item("a.txt", ""),
      done("a.txt", "甲", "A"),
      item("b.txt", "前"),
      done("c.txt", "乙", "B"),
    ];

    expect(
      inherit(old_items, [
        item("x.txt", ""),
        item("x.txt", "甲", { status: "RULE_SKIPPED" }),
        item("y.txt", "甲", { status: "RULE_SKIPPED" }), // 空正文邻居与文件开头不同。
        item("z.txt", "前"),
        item("z.txt", "乙", { status: "RULE_SKIPPED" }), // 旧版 `乙` 前方是文件开头。
        item("w.txt", "乙", { status: "RULE_SKIPPED" }), // 单条目文件。
      ]),
    ).toEqual([
      ["", "NONE"],
      ["A", "PROCESSED"],
      ["", "RULE_SKIPPED"],
      ["", "NONE"],
      ["", "RULE_SKIPPED"],
      ["B", "PROCESSED"],
    ]);
  });

  it("上下文结果冲突时普通条目改用票选，相同结果可多次复用", () => {
    expect(
      inherit(
        [done("a.txt", "同", "甲"), done("b.txt", "同", "乙")],
        [item("x.txt", "同"), item("y.txt", "同", { status: "RULE_SKIPPED" })],
      ),
    ).toEqual([
      ["甲", "PROCESSED"], // 同票取最早结果。
      ["", "RULE_SKIPPED"],
    ]);
    expect(
      inherit(
        [done("a.txt", "同", "甲"), done("b.txt", "同", "甲")],
        [
          item("x.txt", "同", { status: "RULE_SKIPPED" }),
          item("y.txt", "同", { status: "LANGUAGE_SKIPPED" }),
        ],
      ),
    ).toEqual([
      ["甲", "PROCESSED"],
      ["甲", "PROCESSED"],
    ]);
  });

  it("票选按原文与可见姓名分组，按正文译文与可见译名计票", () => {
    const old_items = [
      done("a.txt", "你好", "少数"),
      done("b.txt", "早安", "先出现"), // 文件交错时，同票仍按全局输入顺序选择。
      done("a.txt", "你好", "多数"),
      done("a.txt", "你好", "多数"),
      done("a.txt", "早安", "后出现"),
      // 正文译文相同、译名不同的结果分别计票。
      ...["甲名", "乙名", "乙名"].map((name_dst) =>
        item("a.txt", "你好", { dst: "同译", name_src: "太郎", name_dst, status: "PROCESSED" }),
      ),
    ];
    const next_items = [
      item("x.txt", "早安"),
      item("x.txt", "你好", { status: "DUPLICATED" }),
      item("x.txt", "你好", { name_src: "太郎" }),
      item("x.txt", "你好", { dst: "已有", status: "PROCESSED" }),
    ];

    expect(inherit(old_items, next_items)).toEqual([
      ["先出现", "PROCESSED"], // 同票取最早结果。
      ["多数", "PROCESSED"],
      ["同译", "PROCESSED"],
      ["已有", "PROCESSED"],
    ]);
    expect(next_items[2]?.name_dst).toBe("乙名");
  });

  it("按姓名继承已完成的空正文", () => {
    const old_items = [
      item("a.txt", "", { name_src: "俊輔", name_dst: "俊辅", status: "PROCESSED" }),
    ];
    const next = item("b.txt", "", { name_src: "俊輔", status: "RULE_SKIPPED" });

    inherit_completed_translations(old_items, [next], "fill");

    expect(next).toMatchObject({ dst: "", name_dst: "俊辅", status: "PROCESSED" });
  });

  it("失败条目可经上下文或票选填充，排除条目在两种模式下都不变", () => {
    const old_items = [item("a.txt", "前"), done("a.txt", "甲", "A"), done("b.txt", "乙", "B")];
    for (const mode of ["fill", "overwrite"] as const) {
      expect(
        inherit(
          old_items,
          [
            item("x.txt", "前"),
            item("x.txt", "甲", { status: "ERROR" }),
            item("y.txt", "乙", { status: "ERROR" }),
            item("y.txt", "尾"), // 改变上下文，让失败条目只能经票选填充。
            item("z.txt", "乙", { status: "EXCLUDED" }),
          ],
          mode,
        ),
      ).toEqual([
        ["", "NONE"],
        ["A", "PROCESSED"],
        ["B", "PROCESSED"],
        ["", "NONE"],
        ["", "EXCLUDED"],
      ]);
    }
  });

  it("覆盖模式只在上下文一致时替换已完成译文，并分别统计填充与实际替换", () => {
    const old_items = [
      item("a.txt", "前"),
      done("a.txt", "甲", "新甲"),
      done("a.txt", "同", "同译"),
      done("b.txt", "乙", "新乙"),
    ];
    const next_items = (): TranslationInheritanceItem[] => [
      item("x.txt", "前"),
      done("x.txt", "甲", "旧甲"), // 上下文一致。
      done("x.txt", "同", "同译"), // 上下文一致但结果相同。
      done("y.txt", "乙", "旧乙"), // 仅票选命中。
      item("y.txt", "乙"),
    ];

    const filled = next_items();
    expect(inherit_completed_translations(old_items, filled, "fill")).toEqual({
      filled: 1,
      replaced: 0,
    });
    expect(filled.map((next) => next.dst)).toEqual(["", "旧甲", "同译", "旧乙", "新乙"]);

    const overwritten = next_items();
    expect(inherit_completed_translations(old_items, overwritten, "overwrite")).toEqual({
      filled: 1,
      replaced: 1,
    });
    expect(overwritten.map((next) => next.dst)).toEqual(["", "新甲", "同译", "旧乙", "新乙"]);
  });
});
