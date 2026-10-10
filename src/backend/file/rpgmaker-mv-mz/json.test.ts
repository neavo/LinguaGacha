import type { JsonValue } from "../../../domain/json";
import { expect, it } from "vitest";
import { read_rpgmaker_json } from "./json";
const command = (code: number, parameters: JsonValue[], indent = 0) => ({
  code,
  parameters,
  indent,
});

it("条件、变量和移动路线的脚本只提取字符串，插件参数保持嵌套 JSON 整段", () => {
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
  const items = read_rpgmaker_json(source, "data/CommonEvents.json");
  expect(items.map((item) => item.src)).toEqual([
    "条件",
    "变量",
    "路线",
    "plugin",
    "command",
    "label",
    '{"text":"嵌套"}',
  ]);
  expect(items.every((item) => item.status === "RULE_SKIPPED")).toBe(true);
});
