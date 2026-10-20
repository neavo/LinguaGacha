import { expect, it } from "vitest";
import { build_resource } from "../../../test/godot-fixture";
import { read_resource } from "./resource";
import { build_font_data, enable_system_fallback, remap_font_import } from "./font";
import { u32 } from "./binary";

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
