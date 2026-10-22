import { expect, it } from "vitest";
import { generated_members, RENPY_FONT_FILE, RENPY_GENERATED_MARKER } from "./generated";

it("带产品标记的源码连同编译产物一起排除", () => {
  const files = new Map([
    [RENPY_FONT_FILE, "source"],
    [RENPY_FONT_FILE + "c", "compiled"],
  ]);
  expect(generated_members(files, () => Buffer.from(RENPY_GENERATED_MARKER + "\n"))).toEqual(
    new Set(files.keys()),
  );
});

it.each([
  [RENPY_FONT_FILE, "foreign"],
  [RENPY_FONT_FILE + "c", "compiled"],
  [RENPY_FONT_FILE.toUpperCase(), RENPY_GENERATED_MARKER + "\n"],
  [(RENPY_FONT_FILE + "c").toUpperCase(), "compiled"],
])("拒绝外来、孤立或拼写冲突的资源：%s", (name, content) => {
  expect(() => generated_members(new Map([[name, name]]), () => Buffer.from(content))).toThrow(
    /Reserved|Orphaned/u,
  );
});
