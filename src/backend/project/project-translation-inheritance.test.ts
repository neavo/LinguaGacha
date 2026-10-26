import { describe, expect, it } from "vitest";

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
): Array<[string, string]> {
  inherit_completed_translations(old_items, next_items);
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
      item("x.txt", "你好", { name_src: ["太郎", "附加"] }),
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

  it("复制空正文与完整姓名形状，姓名数组不共享旧快照", () => {
    const old_name_dst = ["俊辅", "附加"];
    const old_items = [
      item("a.txt", "", { name_src: "俊輔", name_dst: old_name_dst, status: "PROCESSED" }),
    ];
    const next = item("b.txt", "", { name_src: "俊輔", status: "RULE_SKIPPED" });

    inherit_completed_translations(old_items, [next]);

    expect(next).toMatchObject({ dst: "", name_dst: ["俊辅", "附加"], status: "PROCESSED" });
    expect(next.name_dst).not.toBe(old_name_dst);
  });
});
