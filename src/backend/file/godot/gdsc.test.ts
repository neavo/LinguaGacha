import { expect, it } from "vitest";
import { create_godot_fixture, gdsc_fixture } from "../../../test/godot-fixture";
import { read_gdsc, patch_gdsc } from "./gdsc";

it.each([
  ["4.3", 100],
  ["4.6", 101],
] as const)("%s 编译脚本只重定向指定 token，保留共享常量与其余引用", (engine, version) => {
  const bytes = create_godot_fixture(engine).get("main.gdc")!;
  const before = read_gdsc(bytes);
  expect(before.version).toBe(version);
  const shared = before.tokens.filter(
    (token) => token.type === 3 && before.constants[token.reference]?.value === "Shared",
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
