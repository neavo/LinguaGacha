import { describe, expect, it } from "vitest";
import { parseSync } from "oxc-parser";
import { create_item } from "../../../domain/item";
import type { RPGMakerLocation } from "./types";
import { write_rpgmaker_items } from "./writer";

const config = { target_language: "ZH" };
const command = (code: number, text: string, indent = 0) => ({ code, indent, parameters: [text] });
function translated(location: RPGMakerLocation, dst = "译文") {
  return create_item({
    src: "原文",
    dst,
    status: "PROCESSED",
    extra_field: { rpgmaker: { usage: "historical", location } },
  });
}

describe("持久 RPG Maker 定位写回", () => {
  it("字段与关联字段按保存路径写回", () => {
    const root = { choices: ["原文", "保留"], branch: "原文" };
    expect(
      write_rpgmaker_items(
        root,
        [translated({ kind: "field", path: ["choices", 0], mirrors: [["branch"]] })],
        config,
      ),
    ).toEqual({ choices: ["译文", "保留"], branch: "译文" });
  });

  it.each([
    { kind: "field", path: ["missing"] },
    { kind: "field", path: ["count"] },
    { kind: "field", path: ["text"], mirrors: [["missing"]] },
    { kind: "field", path: ["text"], mirrors: [["text"]] },
    { kind: "field", path: ["array", -1] },
    { kind: "field", path: ["array", "0"] },
    { kind: "field", path: ["__proto__", "text"] },
  ] satisfies RPGMakerLocation[])("拒绝不存在、类型错误或重复的字段 $path", (location) => {
    const root = { text: "原文", count: 1, array: ["原文"] };
    expect(() => write_rpgmaker_items(root, [translated(location)], config)).toThrow();
    expect(root).toEqual({ text: "原文", count: 1, array: ["原文"] });
  });

  it("事件按文件内列表分别归组，多个块按原始范围倒序重建", () => {
    const root = {
      list: [
        command(101, "头"),
        command(401, "甲"),
        command(401, "乙"),
        command(108, "备注"),
        command(408, "续行"),
        command(0, ""),
      ],
      other: [command(105, "头"), command(405, "滚动"), command(0, "")],
    };
    write_rpgmaker_items(
      root,
      [
        translated({ kind: "block", path: ["list"], start: 1, end: 3, code: 401 }, "合并"),
        translated({ kind: "block", path: ["list"], start: 3, end: 5, code: 108 }, "一\n二\n三"),
        translated({ kind: "block", path: ["other"], start: 1, end: 2, code: 405 }, "滚一\n滚二"),
      ],
      config,
    );
    expect(root.list).toEqual([
      command(101, "头"),
      command(401, "合并"),
      command(108, "一"),
      command(408, "二"),
      command(408, "三"),
      command(0, ""),
    ]);
    expect(root.other).toEqual([
      command(105, "头"),
      command(405, "滚一"),
      command(405, "滚二"),
      command(0, ""),
    ]);
  });

  it("仅有姓名的空对话块可写回", () => {
    const root = {
      list: [{ code: 101, indent: 0, parameters: ["", 0, 0, 2, "原名"] }, command(0, "")],
    };
    const item = translated(
      {
        kind: "block",
        path: ["list"],
        start: 1,
        end: 1,
        code: 401,
        name_path: ["list", 0, "parameters", 4],
      },
      "新增文本",
    );
    item.name_src = "原名";
    item.name_dst = "译名";
    write_rpgmaker_items(root, [item], config);
    expect(root.list[0]?.parameters[4]).toBe("译名");
    expect(root.list[1]).toEqual(command(401, "新增文本"));
  });

  it("空对话插入与相邻脚本替换共用起点时保留原始索引", () => {
    const root = { list: [command(101, "头"), command(355, 'say("旧");'), command(0, "")] };
    write_rpgmaker_items(
      root,
      [
        translated({ kind: "block", path: ["list"], start: 1, end: 1, code: 401 }, "对白"),
        translated(
          {
            kind: "script",
            container: { kind: "block", path: ["list"], start: 1, end: 2, code: 355 },
            start: 4,
            end: 7,
            template: false,
          },
          "脚本",
        ),
      ],
      config,
    );
    expect(root.list).toEqual([
      command(101, "头"),
      command(401, "对白"),
      command(355, 'say("脚本");'),
      command(0, ""),
    ]);
  });

  it.each([
    { start: -1, end: 3, code: 401 },
    { start: 1.5, end: 3, code: 401 },
    { start: 1, end: 99, code: 401 },
    { start: 2, end: 1, code: 401 },
    { start: 1, end: 2, code: 401 },
    { start: 2, end: 3, code: 401 },
    { start: 1, end: 3, code: 405 },
    { start: 1, end: 3, code: 999 },
  ])("拒绝损坏事件范围或指令结构 %j", (range) => {
    const root = { list: [command(101, "头"), command(401, "甲"), command(401, "乙")] };
    expect(() =>
      write_rpgmaker_items(root, [translated({ kind: "block", path: ["list"], ...range })], config),
    ).toThrow();
  });

  it("重复块、与块交叠的字段及不一致缩进均拒绝", () => {
    const root = { list: [command(101, "头"), command(401, "甲")] };
    const block = translated({ kind: "block", path: ["list"], start: 1, end: 2, code: 401 });
    expect(() => write_rpgmaker_items(root, [block, block], config)).toThrow();
    expect(() =>
      write_rpgmaker_items(
        root,
        [block, translated({ kind: "field", path: ["list", 1, "parameters", 0] })],
        config,
      ),
    ).toThrow();
    root.list[1]!.indent = 1;
    expect(() => write_rpgmaker_items(root, [block], config)).toThrow();
  });

  it("保存的 JS 偏移按容器归组，重复文本独立替换并保留模板表达式", () => {
    const root = { first: 'say("同文", "同文");', second: "const x = `前${name}后`;" };
    const items = [
      translated(
        {
          kind: "script",
          container: { kind: "field", path: ["first"] },
          start: 4,
          end: 8,
          template: false,
        },
        '引号"\n😀',
      ),
      translated(
        {
          kind: "script",
          container: { kind: "field", path: ["first"] },
          start: 10,
          end: 14,
          template: false,
        },
        "独立",
      ),
      translated(
        {
          kind: "script",
          container: { kind: "field", path: ["second"] },
          start: 11,
          end: 12,
          template: true,
        },
        "`前${字}",
      ),
      translated(
        {
          kind: "script",
          container: { kind: "field", path: ["second"] },
          start: 19,
          end: 20,
          template: true,
        },
        "尾",
      ),
    ];
    write_rpgmaker_items(root, items, config);
    expect(root.first).toBe('say("引号\\"\\n😀", "独立");');
    expect(root.second).toBe("const x = `\\`前\\${字}${name}尾`;");
    expect(parseSync("output.js", root.first + root.second).errors).toEqual([]);
  });

  it.each([
    { start: -1, end: 8 },
    { start: 4.5, end: 8 },
    { start: 4, end: 80 },
    { start: 8, end: 4 },
    { start: 4, end: 4 },
    { start: 5, end: 8 },
  ])("拒绝损坏 JS 范围或字面量 %j", (range) => {
    expect(() =>
      write_rpgmaker_items(
        'say("原文");',
        [
          translated({
            kind: "script",
            container: { kind: "field", path: [] },
            ...range,
            template: false,
          }),
        ],
        config,
      ),
    ).toThrow();
  });

  it("拒绝重叠 JS 范围", () => {
    const first = translated({
      kind: "script",
      container: { kind: "field", path: [] },
      start: 11,
      end: 13,
      template: true,
    });
    const second = translated({
      kind: "script",
      container: { kind: "field", path: [] },
      start: 12,
      end: 14,
      template: true,
    });
    expect(() => write_rpgmaker_items("const x = `一二三`;", [first, second], config)).toThrow();
  });
});
