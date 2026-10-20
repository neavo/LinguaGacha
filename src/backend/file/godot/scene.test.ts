import { expect, it } from "vitest";
import { create_godot_fixture } from "../../../test/godot-fixture";
import { read_scene, patch_scene } from "./scene";

it("场景共享 Variant 只修改目标节点的 text", () => {
  const bytes = create_godot_fixture().get("scene.scn")!,
    before = read_scene(bytes);
  const first = before.properties.find(
    (property) => property.path === "Display" && property.property === "text",
  )!;
  const other = before.properties.find(
    (property) => property.path === "Unchanged" && property.property === "text",
  )!;
  expect(first.reference).toBe(other.reference);
  const after = read_scene(
    patch_scene(bytes, new Map([[`${first.node}:text`, { original: "Shared", text: "中文🙂" }]])),
  );
  expect(
    after.properties.find(
      (property) => property.node === first.node && property.property === "text",
    )!.value.value,
  ).toBe("中文🙂");
  expect(
    after.properties.find(
      (property) => property.node === other.node && property.property === "text",
    )!.value.value,
  ).toBe("Shared");
  expect(() =>
    patch_scene(bytes, new Map([[`${first.node}:text`, { original: "stale", text: "译文" }]])),
  ).toThrow();
});
