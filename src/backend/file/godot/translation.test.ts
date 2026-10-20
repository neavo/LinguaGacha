import { expect, it } from "vitest";
import {
  build_resource,
  create_godot_fixture,
  godot_project_fixture,
} from "../../../test/godot-fixture";
import {
  read_translation,
  patch_translation,
  translation_slot,
  plan_translation_locale,
  patch_translation_fallback,
} from "./translation";
import { read_resource, resource_string } from "./resource";
import { variant_string, variant_strings } from "./variant";
import { read_project } from "./project";

it("优化表保留全部哈希身份，只追加目标槽位字节", () => {
  const bytes = create_godot_fixture().get("messages.translation")!,
    before = read_translation(bytes);
  expect(before.slots.find((slot) => slot.index === translation_slot(bytes)("KEY"))!.text).toBe(
    "Translated message",
  );
  expect(translation_slot(bytes)("missing")).toBeUndefined();
  const target = before.slots.find((slot) => slot.text === "Translated message")!;
  const result = patch_translation(
      bytes,
      new Map([[target.index, { original: target.text, text: "翻译后的消息" }]]),
    ),
    after = read_translation(result);
  expect(after.hash.value).toEqual(before.hash.value);
  expect(after.slots.map((slot) => [slot.bucket, slot.seed, slot.key])).toEqual(
    before.slots.map((slot) => [slot.bucket, slot.seed, slot.key]),
  );
  expect(after.slots.find((slot) => slot.index === target.index)!.text).toBe("翻译后的消息");
  expect(after.slots.find((slot) => slot.index !== target.index)!.text).toBe(
    before.slots.find((slot) => slot.index !== target.index)!.text,
  );
});

it.each(["existing", "first", "none"])("locale 选择：%s，fallback 只按登记语言表变化", (kind) => {
  const bytes = create_godot_fixture().get("messages.translation")!;
  const doc = read_resource(bytes);
  const properties = new Map(
    doc.properties.map((property) => [
      property.name,
      doc.body.subarray(property.value.start, property.value.end),
    ]),
  );
  properties.set("locale", resource_string("ja"));
  const japanese = build_resource("OptimizedTranslation", properties);
  const fallback = kind === "existing" ? "en" : "fr";
  const original = godot_project_fixture(
    new Map([
      ["internationalization/locale/fallback", variant_string(fallback)],
      [
        "internationalization/locale/translations",
        variant_strings(kind === "none" ? [] : ["res://ja.translation", "res://en.translation"]),
      ],
      ["unrelated", variant_string("keep")],
    ]),
  );
  const plan = plan_translation_locale(
    new Map([
      ["project.binary", original],
      ["ja.translation", japanese],
      ["en.translation", bytes],
    ]),
  );
  expect(plan.locale).toBe(kind === "existing" ? "en" : kind === "first" ? "ja" : null);
  expect([...plan.tables]).toEqual(
    kind === "existing" ? ["en.translation"] : kind === "first" ? ["ja.translation"] : [],
  );
  const output = patch_translation_fallback(original, plan),
    settings = read_project(output);
  expect(
    settings.find((setting) => setting.name === "internationalization/locale/fallback")!.value
      .value,
  ).toBe(kind === "first" ? "ja" : fallback);
  expect(
    settings
      .find((setting) => setting.name === "unrelated")!
      .bytes.equals(read_project(original).find((setting) => setting.name === "unrelated")!.bytes),
  ).toBe(true);
});

it("PO 单行 header 参与语言选择", () => {
  const project = godot_project_fixture(
    new Map([["internationalization/locale/translations", variant_strings(["res://ja.po"])]]),
  );
  const po = Buffer.from(
    'msgid ""\nmsgstr "Language: ja\\n"\n\nmsgid "apple"\nmsgid_plural "apples"\nmsgstr[0] "一つ"\nmsgstr[1] "複数"\n',
  );
  expect(
    plan_translation_locale(
      new Map([
        ["project.binary", project],
        ["ja.po", po],
      ]),
    ).locale,
  ).toBe("ja");
});
