import { describe, expect, it } from "vitest";

import { format_agent_tool_output } from "./agent-tool-output";

describe("format_agent_tool_output", () => {
  it("递归展开任意字段和数组内的多层 JSON，保留标量类型", () => {
    const value = {
      nested: JSON.stringify(JSON.stringify({ items: [JSON.stringify({ ok: true })] })),
      strings: ["123", "true", "null", "", "C:\\new\\test"],
      values: [123, false, null, {}, []],
    };
    const output = format_agent_tool_output(JSON.stringify(value));
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

  it("多行文本块保留空行、缩进和制表符，正文中的结构字符不生成字段高亮", () => {
    const text = '第一行\r\n\r\n\t  "fake": {\r末行\n';
    const output = format_agent_tool_output(
      JSON.stringify({ result: JSON.stringify({ text }), next: 1 }),
    );
    const block = output.ranges.find((range) => range.kind === "text");
    expect(block).toBeDefined();
    expect(output.text.slice(block!.start, block!.end)).toBe(
      '      第一行\n      \n      \t  "fake": {\n      末行\n      ',
    );
    expect(
      output.ranges
        .filter((range) => range.kind === "property")
        .map((range) => output.text.slice(range.start, range.end)),
    ).toEqual(['"result"', '"text"', '"next"']);
    expect(output.text).toContain('"next": 1');
    for (let index = 1; index < output.ranges.length; index++) {
      expect(output.ranges[index]!.start).toBeGreaterThanOrEqual(output.ranges[index - 1]!.end);
    }
  });

  it("混合日志和不完整 JSON 保留原文，字面量换行不自动替换", () => {
    const log = 'log:\n{"items": [1]}\n';
    expect(format_agent_tool_output(log)).toEqual({ text: log, ranges: [] });
    const output = format_agent_tool_output(
      JSON.stringify({ incomplete: '{"x":', literal: String.raw`a\nb`, multiline: "a\nb" }),
    );
    expect(output.text).toContain('"incomplete": "{\\"x\\":"');
    expect(output.text).toContain('"literal": "a\\\\nb"');
    expect(output.text).toContain("    a\n    b");
  });

  it("根级 JSON 字符串显示最终文本或结构，空值仍可辨认", () => {
    expect(format_agent_tool_output(JSON.stringify(JSON.stringify("一\n二"))).text).toBe("一\n二");
    expect(format_agent_tool_output("null").text).toBe("null");
    expect(format_agent_tool_output(JSON.stringify("123")).text).toBe("123");
    expect(format_agent_tool_output("").text).toBe("");
  });
});
