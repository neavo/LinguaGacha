import { expect, it } from "vitest";
import {
  find_agent_reference_ranges,
  format_agent_reference,
  resolve_agent_reference_labels,
  type AgentReference,
} from "./agent-reference";

it("四类引用通过 JSON 字符串保留路径中的空格、引号、反斜杠和括号", () => {
  const references: AgentReference[] = [
    { kind: "file", path: 'E:\\原稿 (一)\\角色 "新版".xlsx' },
    { kind: "workspace", path: '资料/角色 (一) "新版".xlsx' },
    { kind: "upload", path: "uploads/原稿.epub" },
    { kind: "skill", name: "review" },
  ];
  const text = references.map(format_agent_reference).join(" 与 ");
  expect(find_agent_reference_ranges(text).map((range) => range.reference)).toEqual(references);
  for (const range of find_agent_reference_ranges(text))
    expect(text.slice(range.from, range.to)).toBe(range.marker);
});

it.each([
  [
    ["C:\\a\\b\\c.txt", "D:\\a\\b\\c.txt"],
    ["C:/a/b/c.txt", "D:/a/b/c.txt"],
  ],
  [
    ["dir/a.txt", "a.txt"],
    ["dir/a.txt", "a.txt"],
  ],
  [
    ["E:\\Games\\Demo\\", "E:\\Games\\Demo", "/"],
    ["Demo", "Demo", "/"],
  ],
])("同条消息从文件名逐级展开重名路径 %j", (paths, expected) => {
  const [local, ...others] = paths;
  const markers = [
    format_agent_reference({ kind: "file", path: local! }),
    ...others.map((path) => format_agent_reference({ kind: "workspace", path })),
  ];
  expect(resolve_agent_reference_labels(find_agent_reference_ranges(markers.join(" ")))).toEqual([
    ...expected,
  ]);
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
