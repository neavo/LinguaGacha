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
