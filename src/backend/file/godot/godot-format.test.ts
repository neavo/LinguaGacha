import JSZip from "jszip";
import { expect, it } from "vitest";
import {
  create_godot_fixture,
  godot_project_fixture,
  build_resource,
} from "../../../test/godot-fixture";
import { create_godot_adapter } from "./godot-format";
import { GameFormat } from "../shared/game/format";
import { NativeFs } from "../../../native/native-fs";
import { read_godot_metadata } from "./item";
import { read_translation } from "./translation";
import { read_project } from "./project";
import { read_gdsc } from "./gdsc";
import { resource_string, read_resource } from "./resource";
import { read_po } from "./po";
import { variant_strings } from "./variant";
import { u32 } from "./binary";

async function handler_for(files: ReadonlyMap<string, Buffer>) {
  const zip = new JSZip();
  for (const [name, bytes] of files) zip.file(name, bytes);
  return create_godot_adapter().create_members(new Map(Object.entries(zip.files)));
}

it.each(["4.3", "4.6"])(
  "%s 容器读取→条目→译文渲染，project.binary 在零条目时改写 fallback",
  async (engine) => {
    const files = create_godot_fixture(engine),
      zip = new JSZip();
    for (const [name, bytes] of files) zip.file(name, bytes);
    const format = new GameFormat(create_godot_adapter(), new NativeFs());
    const result = await format.read_from_stream(
      await zip.generateAsync({ type: "uint8array" }),
      "game.zip",
    );
    expect(result.warnings).toEqual([]);
    expect(result.items.length).toBeGreaterThan(0);
    expect(
      result.items.every(
        (item) =>
          item.file_type === "GODOT" && item.file_path === "game.zip" && item.name_src === null,
      ),
    ).toBe(true);
    const handler = await handler_for(files),
      original = files.get("messages.translation")!;
    const item = result.items.find(
      (item) => read_godot_metadata(item.extra_field).internal_file_path === "messages.translation",
    )!;
    const output = await handler.render(original, "messages.translation", [
      { ...item, status: "PROCESSED", dst: "中文译文" },
    ]);
    expect(
      read_translation(Buffer.from(output)).slots.some((slot) => slot.text === "中文译文"),
    ).toBe(true);
    expect(await handler.render(original, "messages.translation", [])).toEqual(original);
    const project = await handler.render(files.get("project.binary")!, "project.binary", []);
    expect(
      read_project(Buffer.from(project)).find(
        (setting) => setting.name === "internationalization/locale/fallback",
      )!.value.value,
    ).toBe("en");
    await expect(
      handler.render(original, "messages.translation", [
        { ...item, src: "stale", status: "PROCESSED", dst: "中文" },
      ]),
    ).rejects.toMatchObject({ code: "file.invalid_structure" });
  },
);

it("人工放行代码字符串按持久定位写回，提取分类和条目行号不参与定位", async () => {
  const files = create_godot_fixture(),
    handler = await handler_for(files),
    bytes = files.get("main.gdc")!;
  const parsed = await handler.read_file(bytes, "main.gdc");
  const item = parsed.items.find((item) => item.src === "Shared")!;
  expect(item.status).toBe("RULE_SKIPPED");
  const location = read_godot_metadata(item.extra_field).location;
  expect(location.kind).toBe("gdsc");
  const output = await handler.render(bytes, "main.gdc", [
    { ...item, row: 999, status: "PROCESSED", dst: "人工译文" },
  ]);
  const after = read_gdsc(Buffer.from(output));
  if (location.kind !== "gdsc") throw new Error("Expected token");
  expect(after.constants[after.tokens[location.token]!.reference]!.value).toBe("人工译文");
});

it.each(["broken", "empty-hash"])("语言表 %s 独立处理，正常成员仍可翻译", async (kind) => {
  const original = read_resource(create_godot_fixture().get("messages.translation")!);
  const properties = new Map(
    original.properties.map((property) => [
      property.name,
      original.body.subarray(property.value.start, property.value.end),
    ]),
  );
  properties.set("hash_table", Buffer.concat([u32(32), u32(0)]));
  const files = new Map([
    [
      "project.binary",
      godot_project_fixture(
        new Map([
          ["internationalization/locale/translations", variant_strings(["res://bad.translation"])],
        ]),
      ),
    ],
    [
      "bad.translation",
      kind === "broken"
        ? Buffer.from("broken")
        : build_resource("OptimizedTranslation", properties),
    ],
    ["main.gd", Buffer.from('var text = "Hello world"\n')],
  ]);
  const zip = new JSZip();
  for (const [name, bytes] of files) zip.file(name, bytes);
  const format = new GameFormat(create_godot_adapter(), new NativeFs());
  const parsed = await format.read_from_stream(
    await zip.generateAsync({ type: "uint8array" }),
    "game.zip",
  );
  expect(parsed.warnings.map((warning) => warning.internal_file_path)).toEqual(
    kind === "broken" ? ["bad.translation"] : [],
  );
  expect(parsed.items.map((item) => item.src)).toEqual(["Hello world"]);
  const handler = await handler_for(files);
  expect(await handler.render(files.get("bad.translation")!, "bad.translation", [])).toEqual(
    files.get("bad.translation"),
  );
});

it("Resource 与源码区间写回校验完整定位，空译文保留人工清空语义", async () => {
  const files = new Map([
    ["project.binary", godot_project_fixture()],
    [
      "data.res",
      build_resource("Resource", new Map([["caption", resource_string("Hello world")]])),
    ],
    ["main.gd", Buffer.from('var text = "Hello world"\n')],
  ]);
  const handler = await handler_for(files);
  for (const name of ["main.gd", "data.res"]) {
    const bytes = files.get(name)!,
      item = (await handler.read_file(bytes, name)).items[0]!;
    const output = Buffer.from(
      await handler.render(bytes, name, [{ ...item, status: "PROCESSED", dst: "" }]),
    );
    expect(
      name.endsWith(".gd") ? output.toString() : read_resource(output).properties[0]!.value.value,
    ).toBe(name.endsWith(".gd") ? 'var text = ""\n' : "");
    const metadata = read_godot_metadata(item.extra_field);
    await expect(
      handler.render(bytes, name, [
        {
          ...item,
          status: "PROCESSED",
          dst: "译文",
          extra_field: { godot: { ...metadata, location: { kind: "gd", start: 0, end: 1 } } },
        },
      ]),
    ).rejects.toMatchObject({ code: "file.invalid_structure" });
  }
});

it("PO 写回保留 header、context 与 plural 元数据", async () => {
  const source =
    'msgid ""\nmsgstr ""\n"Language: en\\n"\n"Plural-Forms: nplurals=2; plural=(n != 1);\\n"\n\nmsgctxt "fruit"\nmsgid "apple"\nmsgid_plural "apples"\nmsgstr[0] "one"\nmsgstr[1] "many"\n';
  const project = godot_project_fixture(
    new Map([["internationalization/locale/translations", variant_strings(["res://en.po"])]]),
  );
  const handler = await handler_for(
    new Map([
      ["project.binary", project],
      ["en.po", Buffer.from(source)],
    ]),
  );
  const item = (await handler.read_file(Buffer.from(source), "en.po")).items[0]!;
  const output = Buffer.from(
    await handler.render(Buffer.from(source), "en.po", [
      { ...item, status: "PROCESSED", dst: "一个" },
    ]),
  ).toString();
  expect(
    read_po(output)
      .filter((field) => field.kind === "msgstr")
      .map((field) => field.text),
  ).toEqual(["Language: en\nPlural-Forms: nplurals=2; plural=(n != 1);\n", "一个", "many"]);
  expect(output).toContain('msgctxt "fruit"\nmsgid "apple"\nmsgid_plural "apples"');
});

it.each([
  ["4.3", "TranslationPO"],
  ["4.6", "Translation"],
])("%s %s 只提取译文，写回保留 context、复数规则和消息键", async (engine) => {
  const files = create_godot_fixture(engine);
  files.set(
    "project.binary",
    godot_project_fixture(
      new Map([
        ["internationalization/locale/translations", variant_strings(["res://po.translation"])],
      ]),
    ),
  );
  const handler = await handler_for(files),
    bytes = files.get("po.translation")!;
  const parsed = await handler.read_file(bytes, "po.translation");
  expect(parsed.items.map((item) => item.src).sort()).toEqual(["many", "old", "one"]);
  const item = parsed.items.find((item) => item.src === "one")!;
  const before = read_resource(bytes),
    after = read_resource(
      Buffer.from(
        await handler.render(bytes, "po.translation", [
          { ...item, status: "PROCESSED", dst: "一个" },
        ]),
      ),
    );
  const original_values = before.properties.find((property) => property.name === "messages")!.value
    .children!;
  const updated_values = after.properties.find((property) => property.name === "messages")!.value
    .children!;
  for (let index = 0; index < original_values.length; index += 2)
    expect(after.body.subarray(updated_values[index]!.start, updated_values[index]!.end)).toEqual(
      before.body.subarray(original_values[index]!.start, original_values[index]!.end),
    );
  const metadata = before.properties.find((property) => property.name === "plural_rules_override")!;
  expect(after.properties.find((property) => property.name === metadata.name)!.value.value).toEqual(
    metadata.value.value,
  );
});
