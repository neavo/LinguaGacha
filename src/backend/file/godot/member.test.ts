import { expect, it } from "vitest";
import { build_resource, create_godot_fixture } from "../../../test/godot-fixture";
import { godot_member_kind } from "./member";

it("文件名忽略大小写发现候选，文件头及资源类型决定二进制成员类别", () => {
  expect(
    ["project.binary", "a.GD", "a.PO", "a.GDC", "a.SCN", "a.translation", "a.png"].map((file) =>
      godot_member_kind(file),
    ),
  ).toEqual(["project", "gd", "po", "gdsc", "resource", "translation", null]);
  const script = create_godot_fixture().get("main.gdc")!;
  expect(
    [
      ["Script.RES", script],
      ["Scene.GDC", build_resource("PackedScene", new Map())],
      ["Table.RES", build_resource("Translation", new Map())],
    ].map(([file, bytes]) => godot_member_kind(file as string, bytes as Buffer)),
  ).toEqual(["gdsc", "resource", "translation"]);
});
