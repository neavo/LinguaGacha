import { expect, it } from "vitest";
import { read_source, patch_source } from "./gdscript";

it("源码保留注释、raw/triple 字面量、类型限定与 UTF-16 坐标，单个修改不波及同文引用", () => {
  const source =
    '# "comment"\nvar x = ["😀same", "😀same", r"raw\\n", """line\ntext""", &"name"]\n';
  const literals = read_source(source);
  expect(literals.map((value) => value.text)).toEqual([
    "😀same",
    "😀same",
    "raw\\n",
    "line\ntext",
    "name",
  ]);
  const next = patch_source(
    source,
    new Map([[literals[0]!.start, { original: "😀same", text: '中文\n"引号"' }]]),
  );
  expect(read_source(next).map((value) => value.text)).toEqual([
    '中文\n"引号"',
    "😀same",
    "raw\\n",
    "line\ntext",
    "name",
  ]);
  expect(() =>
    patch_source(source, new Map([[literals[4]!.start, { original: "name", text: "名称" }]])),
  ).toThrow();
  expect(() => read_source('"unterminated')).toThrow();
});
