import { expect, it } from "vitest";
import { build_resource, godot_project_fixture } from "../../../test/godot-fixture";
import { read_resource } from "./resource";
import {
  build_font_data,
  enable_system_fallback,
  remap_font_import,
  godot_font_outputs,
  is_godot_font_file,
} from "./font";
import { u32 } from "./binary";

const OVERRIDE = '[gui]\ntheme/custom_font="res://lg_font.fontdata"\n';
const MAPPING = '[remap]\ntype="FontFile"\npath="res://old.fontdata"\n';
const DISABLED = new Map([
  ["application/config/disable_project_settings_override", Buffer.concat([u32(1), u32(1)])],
]);
const outputs = (fonts: Record<string, string>, settings = new Map<string, Buffer>()) =>
  godot_font_outputs(
    new Map([["project.binary", godot_project_fixture(settings)]]),
    new Map(Object.entries(fonts).map(([name, value]) => [name, Buffer.from(value)])),
    Buffer.from("font"),
  );
const read = (map: Map<string, Uint8Array>, name: string) => Buffer.from(map.get(name)!).toString();

it("导入映射与默认主题共用字体数据，追加覆盖且重复执行不变", () => {
  const original = '[gui/theme]\ncustom_font="res://original.fontdata"';
  const first = outputs({ "a.ttf.import": MAPPING, "override.cfg": original });
  expect([...first.keys()].sort()).toEqual(["a.ttf.import", "lg_font.fontdata", "override.cfg"]);
  expect(read(first, "a.ttf.import")).toBe(
    MAPPING.replace("res://old.fontdata", "res://lg_font.fontdata"),
  );
  expect(read(first, "override.cfg")).toBe(original + "\n" + OVERRIDE);
  expect(read(outputs({ "override.cfg": read(first, "override.cfg") }), "override.cfg")).toBe(
    read(first, "override.cfg"),
  );
  expect(read(outputs({ "override.cfg": original + "\n" }), "override.cfg")).toBe(
    original + "\n" + OVERRIDE,
  );
  expect(read(outputs({}), "override.cfg")).toBe(OVERRIDE);
});

it("项目关闭覆盖时只改导入映射，两者都没有时失败", () => {
  const result = outputs({ "a.ttf.import": MAPPING, "override.cfg": "x" }, DISABLED);
  expect([...result.keys()].sort()).toEqual(["a.ttf.import", "lg_font.fontdata"]);
  expect(() => outputs({}, DISABLED)).toThrow("No font files found");
  expect(() => outputs({ "override.cfg": "x" }, DISABLED)).toThrow("No font files found");
});

it("只收集字体导入与非工具产物的根目录 override.cfg", () => {
  const of = (value: string) => () => Buffer.from(value);
  expect(is_godot_font_file("a.ttf.import", of(MAPPING))).toBe(true);
  expect(is_godot_font_file("Override.cfg", of("[gui]\n"))).toBe(true);
  expect(is_godot_font_file("override.cfg", of(OVERRIDE))).toBe(false);
  expect(is_godot_font_file("override.cfg", of("[application]\n" + OVERRIDE))).toBe(true);
  expect(is_godot_font_file("sub/override.cfg", of("[gui]\n"))).toBe(false);
});

it.each(["FontFile", "SystemFont"])("%s 只打开显式关闭的系统回退", (type) => {
  const bytes = build_resource(
    type,
    new Map([["allow_system_fallback", Buffer.concat([u32(2), u32(0)])]]),
  );
  const next = enable_system_fallback(bytes);
  expect(next.length).toBe(bytes.length);
  expect(read_resource(next).properties[0]!.value.value).toBe(true);
  expect(enable_system_fallback(next)).toBe(next);
  const empty = build_resource(type, new Map());
  expect(enable_system_fallback(empty)).toBe(empty);
});

it("生成的 FontFile 只保存 data 字节", () => {
  const bytes = Buffer.alloc(7, 123);
  const resource = read_resource(build_font_data(bytes));
  expect(resource.type).toBe("FontFile");
  expect(resource.properties).toHaveLength(1);
  expect(resource.properties[0]).toMatchObject({ name: "data", value: { type: 31, value: bytes } });
});

it("只修改 remap 的 path，保留 UID、其他节和 CRLF，重复执行不变", () => {
  const text =
    '[remap]\r\nimporter="font_data_dynamic"\r\ntype="FontFile"\r\nuid="uid://test"\r\npath="res://old.fontdata"\r\n[deps]\r\npath="keep"\r\n';
  const result = remap_font_import(text)!;
  expect(result).toBe(text.replace('path="res://old.fontdata"', 'path="res://lg_font.fontdata"'));
  expect(remap_font_import(result)).toBe(result);
  expect(remap_font_import(text.replace('type="FontFile"', 'type="Texture2D"'))).toBeNull();
  expect(remap_font_import('[deps]\ntype="FontFile"\npath="keep"')).toBeNull();
  expect(() => remap_font_import('[remap]\ntype="FontFile"')).toThrow("no remap path");
});
