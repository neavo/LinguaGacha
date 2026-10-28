import path from "node:path";
import { expect, it } from "vitest";
import { configure_python_parser, PythonSession } from "./python-syntax";

configure_python_parser(path.resolve("build/resources/workspace"));

it.each([
  ["'Alice'", "Alice", undefined],
  ['"Alice"', "Alice", undefined],
  ["u'艾丽丝'", "艾丽丝", undefined],
  ["r'A\\B'", "A\\B", undefined],
  ["('Al' 'ice')", "Alice", undefined],
  ["_('Alice')", "Alice", undefined],
  ["Character('Alice', color='#fff')", "Alice", "display"],
  ["Character(name=_('Alice'))", "Alice", "display"],
  ["Character(None, color='#fff')", undefined, undefined],
  ["Character('expr', dynamic=True)", undefined, "code"],
  ["Character(_('expr'), dynamic=True)", undefined, "code"],
  ["Character('expr', dynamic=flag)", undefined, "code"],
  ["Character('expr', **options)", undefined, "code"],
  ["Character('expr', kind=unknown)", undefined, "code"],
  ["Character('Alice', kind=unknown, dynamic=False)", "Alice", "display"],
  ["DynamicCharacter('expr')", undefined, "code"],
  ["a", undefined, undefined],
  ["store.a", undefined, undefined],
  ["people['Alice']", undefined, undefined],
  ["custom('Alice')", undefined, undefined],
  ["None", undefined, undefined],
  ["extend", undefined, undefined],
] as const)("当前表达式的姓名和默认翻译资格：%s", async (source, expected, usage) => {
  using session = await PythonSession.create();
  const result = (await session.analyze({ source, mode: "eval" })).speaker;
  expect(result.name?.value).toBe(expected);
  expect([...result.usages.values()]).toEqual(usage === undefined ? [] : [usage]);
});
