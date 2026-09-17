import { describe, expect, it } from "vitest";

import { format_agent_tool_output } from "./agent-tool-output";

describe("format_agent_tool_output", () => {
  it("独立结果块分别格式化并以换行分隔，高亮跟随合并后的文本位置", () => {
    const output = format_agent_tool_output(["完成🌸", '{"first":1}', '{"second":2}']);
    expect(output.text).toBe('完成🌸\n{\n  "first": 1\n}\n{\n  "second": 2\n}\n');
    expect(
      output.ranges.map((range) => [range.kind, output.text.slice(range.start, range.end)]),
    ).toEqual([
      ["property", '"first"'],
      ["number", "1"],
      ["property", '"second"'],
      ["number", "2"],
    ]);
  });

  it("递归展开任意字段和数组内的多层 JSON，保留标量类型", () => {
    const value = {
      nested: JSON.stringify(JSON.stringify({ items: [JSON.stringify({ ok: true })] })),
      strings: ["123", "true", "null", "", "C:\\new\\test"],
      values: [123, false, null, {}, []],
    };
    const output = format_agent_tool_output([JSON.stringify(value)]);
    expect(JSON.parse(output.text)).toEqual({
      ...value,
      nested: { items: [{ ok: true }] },
    });
    expect(
      output.ranges
        .filter((range) => range.kind === "property")
        .map((range) => output.text.slice(range.start, range.end)),
    ).toContain('"ok"');
  });

  it("多行文本块裁剪首尾空白行，保留正文缩进、内部空行和高亮位置", () => {
    const text = '\t \r\n  第一行🌸\r\n\r\n\t  "fake": {\r末行  \n\t ';
    const output = format_agent_tool_output([
      JSON.stringify({ result: JSON.stringify({ text }), next: 1 }),
    ]);
    const block = output.ranges.find((range) => range.kind === "text");
    expect(block).toBeDefined();
    expect(output.text.slice(block!.start, block!.end)).toBe(
      '        第一行🌸\n      \n      \t  "fake": {\n      末行  ',
    );
    expect(
      output.ranges
        .filter((range) => range.kind === "property")
        .map((range) => output.text.slice(range.start, range.end)),
    ).toEqual(['"result"', '"text"', '"next"']);
    expect(output.text).toContain('"next": 1');
    expect(
      output.ranges
        .filter((range) => range.kind === "number")
        .map((range) => output.text.slice(range.start, range.end)),
    ).toEqual(["1"]);
    for (let index = 1; index < output.ranges.length; index++) {
      expect(output.ranges[index]!.start).toBeGreaterThanOrEqual(output.ranges[index - 1]!.end);
    }
  });

  it("普通文本和根级 JSON 字符串使用相同的空白行清理规则", () => {
    const text = " \r\n\t一\r\n\r\n  二  \r\t ";
    const expected = { text: "\t一\n\n  二  \n", ranges: [] };
    expect(format_agent_tool_output([text])).toEqual(expected);
    expect(format_agent_tool_output([JSON.stringify(JSON.stringify(text))])).toEqual(expected);
  });

  it("嵌套字符串按清理后的内容显示为单行或空字符串", () => {
    const output = format_agent_tool_output([
      JSON.stringify({ items: ["\n  一  \r\n", " \r\n\t ", "  二  "] }),
    ]);
    expect(JSON.parse(output.text)).toEqual({ items: ["  一  ", "", "  二  "] });
    expect(
      output.ranges
        .filter((range) => range.kind === "string")
        .map((range) => output.text.slice(range.start, range.end)),
    ).toEqual(['"  一  "', '""', '"  二  "']);
  });

  it("混合日志和不完整 JSON 保留原文，字面量换行不自动替换", () => {
    const log = 'log:\n{"items": [1]}\n';
    expect(format_agent_tool_output([log])).toEqual({ text: log, ranges: [] });
    const output = format_agent_tool_output([
      JSON.stringify({ incomplete: '{"x":', literal: String.raw`a\nb`, multiline: "a\nb" }),
    ]);
    expect(output.text).toContain('"incomplete": "{\\"x\\":"');
    expect(output.text).toContain('"literal": "a\\\\nb"');
    expect(output.text).toContain("    a\n    b");
  });

  it("根级 JSON 字符串显示最终文本或结构，空值仍可辨认", () => {
    expect(format_agent_tool_output([JSON.stringify(JSON.stringify("一\n二"))]).text).toBe(
      "一\n二\n",
    );
    expect(format_agent_tool_output(["null"]).text).toBe("null\n");
    expect(format_agent_tool_output([JSON.stringify("123")]).text).toBe("123\n");
  });

  it("清理后各块补齐分隔 LF，空白块占一行并区分无输出", () => {
    expect(format_agent_tool_output([])).toEqual({ text: "", ranges: [] });
    expect(format_agent_tool_output([""]).text).toBe("\n");
    const output = format_agent_tool_output(["甲\r\n\r\n", " \r\n\t ", "乙\r", '{"ok":true}']);
    expect(output.text).toBe('甲\n\n乙\n{\n  "ok": true\n}\n');
    expect(output.ranges.map((range) => output.text.slice(range.start, range.end))).toEqual([
      '"ok"',
      "true",
    ]);
  });
});
