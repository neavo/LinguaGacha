import { expect, it } from "vitest";
import {
  find_agent_reference_ranges,
  format_agent_reference,
  type AgentReference,
} from "./agent-reference";

it("三类引用通过 JSON 字符串保留路径中的空格、引号和括号", () => {
  const references: AgentReference[] = [
    { kind: "project", path: '资料/角色 (一) "新版".xlsx' },
    { kind: "upload", path: "uploads/原稿.epub" },
    { kind: "skill", name: "review" },
  ];
  const text = references.map(format_agent_reference).join(" 与 ");
  expect(find_agent_reference_ranges(text).map((range) => range.reference)).toEqual(references);
  for (const range of find_agent_reference_ranges(text))
    expect(text.slice(range.from, range.to)).toBe(range.marker);
});

it("识别独立于当前目录，忽略转义和未完成输入", () => {
  expect(find_agent_reference_ranges('\\@skill("hidden") @skill(name) @skill("incomplete')).toEqual(
    [],
  );
  expect(find_agent_reference_ranges('\\\\@skill("unknown")')[0]?.reference).toEqual({
    kind: "skill",
    name: "unknown",
  });
  expect(find_agent_reference_ranges('@upload_file("bad\\q")')).toEqual([]);
});
