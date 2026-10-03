import { expect, it } from "vitest";
import { format_agent_json_preview } from "./agent-json-preview";

it("格式化嵌套 JSON 并保留大整数、重复键、数值写法和字符串转义", () => {
  const result = format_agent_json_preview(
    '{"id":9007199254740993,"id":1e400,"text":"a\\nb\\u0020","items":[true,null,{},[]]}',
    "json",
  );
  const indent = result.text.split("\n")[1]!.match(/^ +/u)?.[0] ?? "";
  expect(indent).not.toBe("");
  expect(result.text).toBe(
    [
      "{",
      '\t"id": 9007199254740993,',
      '\t"id": 1e400,',
      '\t"text": "a\\nb\\u0020",',
      '\t"items": [',
      "\t\ttrue,",
      "\t\tnull,",
      "\t\t{},",
      "\t\t[]",
      "\t]",
      "}",
    ]
      .join("\n")
      .replaceAll("\t", indent),
  );
  expect(
    result.ranges.map(({ start, end, kind }) => [result.text.slice(start, end), kind]),
  ).toEqual([
    ['"id"', "property"],
    ["9007199254740993", "number"],
    ['"id"', "property"],
    ["1e400", "number"],
    ['"text"', "property"],
    ['"a\\nb\\u0020"', "string"],
    ['"items"', "property"],
    ["true", "keyword"],
    ["null", "keyword"],
  ]);
});

it("JSONL 独立格式化各行并合并高亮范围", () => {
  const result = format_agent_json_preview('\r\n{"a":1}\r\n"文本"\r\nfalse\r\nnull\r\n', "jsonl");
  expect(result.text.replace(/^ +/gmu, "")).toBe('{\n"a": 1\n}\n\n"文本"\n\nfalse\n\nnull');
  expect(
    result.ranges.map(({ start, end, kind }) => [result.text.slice(start, end), kind]),
  ).toEqual([
    ['"a"', "property"],
    ["1", "number"],
    ['"文本"', "string"],
    ["false", "keyword"],
    ["null", "keyword"],
  ]);
});

it.each([
  ["json", '{\n"a":\n}'],
  ["json", '{"a":1}\n{"b":2}'],
  ["json", ""],
  ["jsonl", '{"a":1}\n{bad}\n{"b":2}'],
] as const)("%s 损坏时终止整份预览：%s", (format, source) => {
  expect(() => format_agent_json_preview(source, format)).toThrow(SyntaxError);
});

it("空 JSONL 显示空文档", () => {
  expect(format_agent_json_preview("\r\n  \r\n", "jsonl")).toEqual({
    text: "",
    ranges: [],
  });
});
