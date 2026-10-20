import { expect, it } from "vitest";
import {
  create_godot_fixture,
  gdsc_fixture,
  GODOT_COMPILED_SCRIPT_FIXTURE,
} from "../../../test/godot-fixture";
import { read_gdsc, patch_gdsc, print_gdsc } from "./gdsc";

it.each([
  ["4.3", 100],
  ["4.6", 101],
] as const)("%s 编译脚本只重定向指定 token，保留共享常量与其余引用", (engine, version) => {
  const bytes = create_godot_fixture(engine).get("main.gdc")!;
  const before = read_gdsc(bytes);
  expect(before.version).toBe(version);
  const shared = before.tokens.filter(
    (token) => token.kind === "LITERAL" && before.constants[token.reference]?.value === "Shared",
  );
  expect(shared.length).toBeGreaterThan(1);
  expect(shared[0]!.reference).toBe(shared[1]!.reference);
  const translated = '中文\n"%s"';
  const after = read_gdsc(
    patch_gdsc(bytes, new Map([[shared[0]!.index, { original: "Shared", text: translated }]])),
  );
  expect(after.constants[after.tokens[shared[0]!.index]!.reference]!.value).toBe(translated);
  expect(after.tokens[shared[1]!.index]!.reference).toBe(shared[1]!.reference);
  expect(after.constants.slice(0, before.constants.length)).toEqual(before.constants);
  expect(() =>
    patch_gdsc(bytes, new Map([[shared[0]!.index, { original: "stale", text: "译文" }]])),
  ).toThrow();
});

it.each([100, 101])("%s 对齐由追加常量的 UTF-8 字节数决定，短 token 扩为宽引用", (version) => {
  const bytes = gdsc_fixture(
    version,
    [
      [3, 0],
      [3, 0],
    ],
    ["same"],
  );
  for (const text of ["a", "ab", "abc", "abcd", "中文🙂"]) {
    const after = read_gdsc(patch_gdsc(bytes, new Map([[0, { original: "same", text }]])));
    expect(after.constants[after.tokens[0]!.reference]!.value).toBe(text);
    expect(after.constants[after.tokens[1]!.reference]!.value).toBe("same");
  }
});

it.each(["4.3", "4.6"] as const)("%s 真实编译脚本保留注解、行号及 tab 嵌套语义", (version) => {
  const source = GODOT_COMPILED_SCRIPT_FIXTURE.source.split("\n");
  const g = read_gdsc(Buffer.from(GODOT_COMPILED_SCRIPT_FIXTURE.scripts[version], "base64"));
  expect(g.version).toBe(version === "4.3" ? 100 : 101);
  const lines = print_gdsc(g).split("\n");
  const annotation = g.tokens.find((token) => token.kind === "ANNOTATION")!;
  expect(g.identifiers[annotation.reference]).toBe("@export");
  expect(lines[annotation.line - 1]).toMatch(/^@export /u);
  for (const token of g.tokens.filter((t) => t.kind === "LITERAL")) {
    const text = g.constants[token.reference]!.value as string;
    expect(source[token.line - 1]).toContain(text);
    expect(lines[token.line - 1]).toContain(JSON.stringify(text));
  }
  const columns = new Map([...g.columns].map(([index, column]) => [g.tokens[index]!.line, column]));
  expect([columns.get(5), columns.get(6), columns.get(7)]).toEqual([5, 9, 5]);
  const indent = (line: string) => line.length - line.trimStart().length;
  expect(indent(lines[5]!)).toBeGreaterThan(indent(lines[4]!));
  expect(indent(lines[6]!)).toBe(indent(lines[4]!));
});
