import JSZip from "jszip";
import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import {
  ruby_array as a,
  ruby_string as s,
  ruby_integer as n,
  ruby_command as c,
  ruby_object as o,
  ruby_symbol,
} from "../../../test/rgss-fixture";
import { decode, encode, type MarshalNode } from "./marshal";
import { read_rgss_json, read_rgss_sources } from "./readable";
import { read_game_container } from "../shared/game/format";
import { write_text } from "./value";
import { RGSS_VERSIONS } from "./source";

it("事件保留类、字段、指令顺序和参数，共享对象及循环使用可解析的位置引用", () => {
  const shared = s("选择");
  const root = o("RPG::Event", {
    "@id": n(7),
    "@list": a([c(102, [shared], 1), c(402, [shared], 1)]),
  });
  root.pairs!.push([ruby_symbol("@self"), root]);
  const result = read_rgss_json(decode(encode(root)));
  expect(result).toEqual({
    $class: "RPG::Event",
    $fields: {
      "@id": 7,
      "@list": [
        {
          $class: "RPG::EventCommand",
          $fields: { "@code": 102, "@indent": 1, "@parameters": ["选择"] },
        },
        {
          $class: "RPG::EventCommand",
          $fields: {
            "@code": 402,
            "@indent": 1,
            "@parameters": [{ $ref: "#/$fields/@list/0/$fields/@parameters/0" }],
          },
        },
      ],
      "@self": { $ref: "#" },
    },
  });
});

it("Hash 键、默认值、二进制载荷与额外包装不会丢失，引用路径转义字段名称", () => {
  const shared = a([n(9)]);
  const raw = Buffer.from([255, 0, 128]);
  const wrapped: MarshalNode = {
    t: "I",
    child: { t: '"', data: write_text("選択", "cp932") },
    pairs: [
      [ruby_symbol("encoding"), s("cp932")],
      [ruby_symbol("@custom"), n(2)],
    ],
  };
  const root = o("Fixture", {
    "@a~/b": shared,
    "@alias": shared,
    "@hash": {
      t: "}",
      pairs: [
        [n(1), s("one")],
        [s("1"), s("text")],
      ],
      default: { t: "F" },
    },
    "@table": { t: "u", klass: ruby_symbol("Table"), data: raw },
    "@binary": { t: '"', data: raw },
    "@wrapped": wrapped,
    "@wrapped_alias": wrapped,
    "@special": { t: "f", data: Buffer.from("nan") },
  });
  expect(read_rgss_json(decode(encode(root)))).toMatchObject({
    $fields: {
      "@alias": { $ref: "#/$fields/@a~0~1b" },
      "@hash": {
        $type: "}",
        $entries: [
          [1, "one"],
          ["1", "text"],
        ],
        $default: false,
      },
      "@table": { $type: "u", $class: "Table", $bytes: raw.toString("base64") },
      "@binary": {
        $type: "string",
        $bytes: raw.toString("base64"),
        $error: expect.any(String),
      },
      "@wrapped": {
        $type: "I",
        $value: "選択",
        $entries: [
          [{ $type: ":", $value: "encoding" }, "cp932"],
          [{ $type: ":", $value: "@custom" }, 2],
        ],
      },
      "@wrapped_alias": { $ref: "#/$fields/@wrapped" },
      "@special": { $type: "f", $value: "nan" },
    },
  });
});

it.each(Object.values(RGSS_VERSIONS))(
  "%s 原稿按配置输出完整脚本，单段与单文件失败保留位置",
  async (extension) => {
    const source = '# coding: cp932\nputs "選択"\n';
    const good: MarshalNode = { t: '"', data: deflateSync(write_text(source, "cp932")) };
    const scripts = a([
      a([n(9), s("../重复"), good]),
      a([n(10), s("../重复"), { t: '"', data: Buffer.from("broken") }]),
      a([n(11), s(""), good]),
    ]);
    const zip = new JSZip()
      .file("Game.ini", `[Game]\nScripts=Custom\\SCRIPTS${extension}\n`)
      .file(`Data/System${extension}`, encode(o("RPG::System", { "@game_title": s("标题") })))
      .file(`Custom/Scripts${extension}`, encode(scripts))
      .file(`Data/Broken${extension}`, Buffer.from("broken"));
    const files = await read_game_container(
      await zip.generateAsync({ type: "uint8array" }),
      "fixture",
    );
    const output = new Map<string, Uint8Array>();
    for await (const [name, content] of read_rgss_sources(files)) output.set(name, content);
    const read = (name: string) => Buffer.from(output.get(name)!).toString("utf8");
    expect(read(`Custom/Scripts${extension}/0000.rb`)).toBe(source);
    expect(read(`Custom/Scripts${extension}/0002.rb`)).toBe(source);
    expect(output.has(`Custom/Scripts${extension}/0001.rb`)).toBe(false);
    expect(JSON.parse(read(`Custom/Scripts${extension}/scripts.json`))).toEqual([
      { index: 0, id: 9, name: "../重复", encoding: "cp932", file: "0000.rb" },
      { index: 1, id: 10, name: "../重复", error: expect.any(String) },
      { index: 2, id: 11, name: "", encoding: "cp932", file: "0002.rb" },
    ]);
    expect(JSON.parse(read(`Data/System${extension}.json`))).toEqual({
      $class: "RPG::System",
      $fields: { "@game_title": "标题" },
    });
    expect(JSON.parse(read(`Data/Broken${extension}.error.json`))).toMatchObject({
      file: `Data/Broken${extension}`,
      error: expect.any(String),
    });
    expect(read(`Data/Broken${extension}`)).toBe("broken");
    expect(output.has(`Data/System${extension}`)).toBe(false);
  },
);

it.each([false, true])("配置存在=%s 时，报告缺失的配置或脚本位置", async (has_ini) => {
  const content = encode(a([]));
  const zip = new JSZip().file("Data/System.rvdata2", content);
  if (has_ini) zip.file("Game.ini", "[Game]\n");
  const files = await read_game_container(
    await zip.generateAsync({ type: "uint8array" }),
    "fixture",
  );
  const output = new Map<string, Uint8Array>();
  for await (const [name, bytes] of read_rgss_sources(files)) output.set(name, bytes);
  if (!has_ini) expect(Buffer.from(output.get("Data/System.rvdata2")!)).toEqual(content);
  const diagnostic = has_ini ? "Data/Scripts.rvdata2.error.json" : "rgss.error.json";
  expect(JSON.parse(Buffer.from(output.get(diagnostic)!).toString())).toEqual({
    file: has_ini ? "Data/Scripts.rvdata2" : "Game.ini",
    error: expect.any(String),
  });
});
