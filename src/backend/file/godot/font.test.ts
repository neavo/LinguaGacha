import { expect, it } from "vitest";
import { build_resource } from "../../../test/godot-fixture";
import { read_resource } from "./resource";
import { enable_system_fallback } from "./font";
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
