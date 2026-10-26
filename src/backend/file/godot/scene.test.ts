import { expect, it } from "vitest";
import { create_godot_fixture, godot_nested_scene_fixture } from "../../../test/godot-fixture";
import { read_resource } from "./resource";
import { read_scene, patch_scene, scene_strings } from "./scene";

it("场景共享 Variant 只修改目标节点的 text", () => {
  const bytes = create_godot_fixture().get("scene.scn")!,
    before = read_scene(read_resource(bytes));
  expect(patch_scene(before, [])).toBe(bytes);
  const first = before.properties.find(
    (property) => property.path === "Display" && property.property === "text",
  )!;
  const other = before.properties.find(
    (property) => property.path === "Unchanged" && property.property === "text",
  )!;
  expect(first.value.start).toBe(other.value.start);
  const after = read_scene(
    read_resource(
      patch_scene(before, [
        {
          location: { kind: "scene", node: first.node, property: "text" },
          original: "Shared",
          text: "中文🙂",
        },
      ]),
    ),
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
});

it.each([false, true])("容器按属性合并修改并保留共享原值，压缩=%s", (compressed) => {
  const before = read_scene(read_resource(godot_nested_scene_fixture(compressed)));
  const property = before.properties[0]!;
  const strings = [...scene_strings(property)];
  const translations = new Map([
    ["Hello world", "你好，世界🙂"],
    ["Alice", "爱丽丝"],
    ["Bob Smith", ""],
    ["Named value", "新标识"],
    ["Key child", "人工放行"],
  ]);
  const changes = strings
    .filter((s) => translations.has(s.value.value))
    .map((s) => ({
      location: s.location,
      original: s.value.value,
      text: translations.get(s.value.value)!,
    }));
  const after = read_scene(read_resource(patch_scene(before, changes)));
  expect(after.doc.compressed).toBe(compressed);
  expect(after.variants.children).toHaveLength(before.variants.children!.length + 1);
  expect(
    [...scene_strings(after.properties[0]!)].map((s) => [s.value.type, s.value.value]),
  ).toEqual(strings.map((s) => [s.value.type, translations.get(s.value.value) ?? s.value.value]));
  const unchanged = after.properties[1]!.value;
  expect(after.doc.body.subarray(unchanged.start, unchanged.end)).toEqual(
    before.doc.body.subarray(property.value.start, property.value.end),
  );
  expect(after.properties[0]!.value.children![3]!.value).toBe(42);
  expect(() => patch_scene(before, [changes[0]!, changes[0]!])).toThrow("Duplicate scene string");
  expect(() => patch_scene(before, [{ ...changes[0]!, original: "stale" }])).toThrow(
    "Stale scene text",
  );
  for (const offset of [
    before.doc.properties[0]!.value.children![0]!.start,
    before.variants.start,
    property.value.children![3]!.start,
  ])
    expect(() =>
      patch_scene(before, [
        {
          ...changes[0]!,
          location: {
            kind: "scene_value",
            node: property.node,
            property: property.property,
            offset,
          },
        },
      ]),
    ).toThrow("Invalid scene string offset");
});

it("共享容器的两个节点可在同一批次写入不同译文", () => {
  const before = read_scene(read_resource(godot_nested_scene_fixture()));
  const changes = before.properties.flatMap((property) =>
    [...scene_strings(property)]
      .filter(({ value }) => value.value === "Hello world" || value.value === "Alice")
      .map(({ location, value }) => ({
        location,
        original: value.value,
        text: `${property.node}：${value.value}`,
      })),
  );
  const after = read_scene(read_resource(patch_scene(before, changes.reverse())));
  expect(after.variants.children).toHaveLength(before.variants.children!.length + 2);
  for (const property of after.properties) {
    const texts = [...scene_strings(property)].map(({ value }) => value.value);
    expect(texts).toContain(`${property.node}：Hello world`);
    expect(texts).toContain(`${property.node}：Alice`);
    expect(texts).toContain("Bob Smith");
  }
});
