import { expect, it } from "vitest";
import { godot_project_fixture } from "../../../test/godot-fixture";
import { patch_project, read_project } from "./project";
import { variant_string } from "./variant";

it("ECFG 单项改写保留其余 Variant 原字节，截断配置拒绝读取", () => {
  const original = godot_project_fixture(
    new Map([
      ["first", variant_string("keep")],
      ["fallback", variant_string("fr")],
    ]),
  );
  const next = read_project(patch_project(original, new Map([["fallback", variant_string("ja")]])));
  expect(next.map((setting) => [setting.name, setting.value.value])).toEqual([
    ["first", "keep"],
    ["fallback", "ja"],
  ]);
  expect(next[0]!.bytes.equals(read_project(original)[0]!.bytes)).toBe(true);
  expect(() => read_project(original.subarray(0, -1))).toThrow();
});
