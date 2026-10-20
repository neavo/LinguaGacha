import { expect, it } from "vitest";
import { create_text_extractor } from "./extract";
import { build_resource, gdsc_fixture, create_godot_fixture } from "../../../test/godot-fixture";
import { resource_string } from "./resource";

it.each([100, 101])("候选漏斗按 GDSC %s 的 COLON 编号和显示用途分类", (version) => {
  const colon = version === 100 ? 83 : 84;
  const cases: [string, readonly [number, number][], readonly string[], boolean | null][] = [
    [
      "Dictionary key",
      [
        [3, 0],
        [colon, 0],
      ],
      [],
      false,
    ],
    [
      "Hello world",
      [
        [2, 0],
        [28, 0],
        [3, 0],
      ],
      ["text"],
      true,
    ],
    [
      "print text",
      [
        [2, 0],
        [77, 0],
        [3, 0],
        [78, 0],
      ],
      ["print"],
      false,
    ],
    [
      "Hello",
      [
        [2, 0],
        [77, 0],
        [3, 0],
        [78, 0],
      ],
      ["tr"],
      true,
    ],
    [
      "Comparison text",
      [
        [8, 0],
        [3, 0],
      ],
      [],
      false,
    ],
    [
      "Index text",
      [
        [2, 0],
        [73, 0],
        [3, 0],
        [74, 0],
      ],
      ["data"],
      false,
    ],
    [
      "Enum text",
      [
        [1, 0],
        [77, 0],
        [3, 0],
        [78, 0],
      ],
      ["export_enum"],
      false,
    ],
    ["Hello world", [[3, 0]], [], true],
    ["你好", [[3, 0]], [], true],
    ["ASCII_TOKEN", [[3, 0]], [], false],
    ["res://file", [[3, 0]], [], null],
    ["#ff0011", [[3, 0]], [], null],
    ["[b]%s[/b]", [[3, 0]], [], null],
    ["\ue001test", [[3, 0]], [], null],
  ];
  const extractor = create_text_extractor(new Map());
  for (const [text, tokens, identifiers, eligible] of cases) {
    const entries = extractor.extract(
      "main.gdc",
      gdsc_fixture(version, tokens, [text], identifiers),
    );
    expect(
      entries.map((entry) => entry.eligible),
      text,
    ).toEqual(eligible === null ? [] : [eligible]);
  }
});

it("语言表消息键跳过，优化表译文与显示属性分别提取", () => {
  const files = create_godot_fixture(),
    extractor = create_text_extractor(files);
  expect(extractor.extract("main.gd", Buffer.from('var text = "Shared"'))[0]!.eligible).toBe(false);
  expect(
    extractor
      .extract("main.gdc", files.get("main.gdc")!)
      .filter((entry) => entry.original === "Shared")
      .every((entry) => !entry.eligible),
  ).toBe(true);
  expect(
    extractor
      .extract("messages.translation", files.get("messages.translation")!)
      .map((entry) => entry.original)
      .sort(),
  ).toEqual(["Shared message", "Translated message"]);
  expect(
    extractor
      .extract("scene.scn", files.get("scene.scn")!)
      .filter((entry) => entry.original === "Shared")
      .every((entry) => !entry.eligible),
  ).toBe(true);
  const standalone = create_text_extractor(new Map());
  expect(
    standalone
      .extract("scene.scn", files.get("scene.scn")!)
      .filter((entry) => entry.original === "Shared")
      .every((entry) => entry.eligible),
  ).toBe(true);
});

it("源码与自定义 Resource 收集文字，内置非文本资源忽略", () => {
  const extractor = create_text_extractor(new Map());
  const source = Buffer.from(
    'var x = {"Dictionary key": "Hello world"}\nvar key = &"Identifier"\n# "comment"\n',
  );
  expect(
    extractor.extract("main.gd", source).map((entry) => [entry.original, entry.eligible]),
  ).toEqual([
    ["Dictionary key", false],
    ["Hello world", true],
  ]);
  const properties = new Map([["caption", resource_string("Hello world")]]);
  expect(
    extractor
      .extract("data.res", build_resource("Resource", properties))
      .map((entry) => entry.original),
  ).toEqual(["Hello world"]);
  expect(extractor.extract("font.res", build_resource("FontFile", properties))).toEqual([]);
});
