import { expect, it } from "vitest";
import { format_agent_tool_label } from "./agent-tool-label";

it.each([
  ['{"name":"sample"}', "read_skill · sample"],
  ['{"name":"sample","path":"SKILL.md"}', "read_skill · sample"],
  ['{"name":"sample","path":"aaa/bbb.md"}', "read_skill · sample\\aaa\\bbb.md"],
])("技能调用 %s 显示对应读取目标或工具名", (input, expected) => {
  expect(format_agent_tool_label("read_skill", input)).toBe(expected);
});

it("无法解释的技能输入保留工具名，完整输入由详情展示", () => {
  for (const input of [
    "broken JSON",
    "null",
    '{"path":"SKILL.md"}',
    '{"name":"sample","path":42}',
  ]) {
    expect(format_agent_tool_label("read_skill", input)).toBe("read_skill");
  }
});
