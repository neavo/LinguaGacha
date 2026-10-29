import type { JsonValue } from "../../../domain/json";
import { expect, it } from "vitest";
import { read_rpgmaker_json } from "./json";
const command = (code: number, parameters: JsonValue[], indent = 0) => ({
  code,
  parameters,
  indent,
}); // 保留原稿的事件指令结构。

it("条件、变量和移动路线的脚本只提取字符串，插件参数展开 JSON 并继承用途", () => {
  const source = [
    {
      list: [
        command(111, [12, 'x === "条件"']),
        command(122, [1, 1, 0, 4, '"变量"']),
        command(205, [0, { list: [{ code: 45, parameters: ['say("路线")'] }] }]),
        command(357, ["plugin", "command", "label", { data: '{"text":"嵌套"}' }]),
      ],
    },
  ];
  const { items } = read_rpgmaker_json(source, "data/CommonEvents.json");
  expect(items.map((item) => [item.src, item.status])).toEqual([
    ["条件", "RULE_SKIPPED"],
    ["变量", "RULE_SKIPPED"],
    ["路线", "RULE_SKIPPED"],
    ["plugin", "RULE_SKIPPED"],
    ["command", "RULE_SKIPPED"],
    ["label", "RULE_SKIPPED"],
    ["嵌套", "RULE_SKIPPED"],
  ]);
});

it("默认翻译字段完整保存 JSON 形状文本，元数据展开为默认排除叶子，子目录同名文件不套用数据库字段", () => {
  const visible = JSON.stringify({ 開始: 1, 終了: 2 });
  const plugin = JSON.stringify({ message: "こんにちは", image: "Actor1" });
  const source = [null, { name: visible, note: plugin }];
  expect(
    read_rpgmaker_json(source, "www/data/Items.JSON").items.map((item) => [item.src, item.status]),
  ).toEqual([
    [visible, "NONE"],
    ["こんにちは", "RULE_SKIPPED"],
    ["Actor1", "RULE_SKIPPED"],
  ]);
  expect(
    read_rpgmaker_json(source, "data/plugin/Items.json").items.map((item) => [
      item.src,
      item.status,
    ]),
  ).toEqual([
    ["こんにちは", "RULE_SKIPPED"],
    ["Actor1", "RULE_SKIPPED"],
  ]);
});

it.each([
  { name: "合法 JS 与注释空白", lines: ['  say("テキスト-表示"); // 注释', "", "  // 尾行  "] },
  { name: "无字符串 JS", lines: ["$gameSwitches.setValue(1, true);", "counter++;"] },
  { name: "非法 JS", lines: ['say("テキスト-表示");', "if()array.push;"] },
  { name: "可解析插件指令", lines: ["CBR-設定", "テキスト-本文"] },
  {
    name: "内嵌 JSON",
    lines: ['{"text":"テキスト-本文","nested":"{\\"label\\":\\"テキスト-内部\\"}"}'],
  },
  { name: "纯空白", lines: ["  \t"] },
  { name: "仅换行", lines: ["", ""] },
  { name: "完全空字符串", lines: [""] },
])("事件脚本整块保留且不产生语法警告：$name", ({ lines }) => {
  const list = [
    command(0, []),
    ...lines.map((line, index) => command(index === 0 ? 355 : 655, [line], 2)),
    command(0, []),
  ];
  const { items, warnings } = read_rpgmaker_json([null, { list }], "data/CommonEvents.json");
  const src = lines.join("\n");
  expect(warnings).toEqual([]);
  expect(items).toHaveLength(src === "" ? 0 : 1);
  if (src !== "") {
    expect(items[0]).toMatchObject({
      src,
      status: "RULE_SKIPPED",
      extra_field: {
        rpgmaker_mv_mz: {
          usage: "metadata",
          location: {
            kind: "block",
            path: [1, "list"],
            start: 1,
            end: 1 + lines.length,
            code: 355,
          },
        },
      },
    });
  }
});
