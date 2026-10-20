import { expect, it } from "vitest";
import { godot_default_status, read_godot_metadata } from "./item";

it("元数据默认用途与坐标收窄，非法路径或不完整定位拒绝消费", () => {
  const godot = {
    internal_file_path: "main.gdc",
    usage: "code",
    location: { kind: "gdsc", token: 7 },
  };
  expect(godot_default_status({ extra_field: { godot } })).toBe("RULE_SKIPPED");
  expect(godot_default_status({ extra_field: { godot: { ...godot, usage: "text" } } })).toBe(
    "NONE",
  );
  for (const invalid of [
    { ...godot, internal_file_path: "../a" },
    { ...godot, usage: "other" },
    { ...godot, location: { kind: "gd", start: 1, end: 0 } },
    { ...godot, location: { kind: "scene", node: 0 } },
  ])
    expect(() => read_godot_metadata({ godot: invalid })).toThrow();
});
