import { sha1_hex } from "./lexer";
import { configure_python_parser } from "../renpy/python-syntax";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { create_item } from "../../../domain/item";
import { RenpyRpyFormat } from "./renpy-rpy-format";

it("原始资产缺失时拒绝导出 Ren’Py 脚本", async () => {
  using temp_dir = fs.mkdtempDisposableSync(
    path.join(os.tmpdir(), "linguagacha-renpy-rpy-format-"),
  );
  await expect(
    new RenpyRpyFormat().write_to_path(
      [create_item({ file_type: "RENPY_RPY", file_path: "script.rpy", src: "原文", dst: "译文" })],
      { translated_path: temp_dir.path, bilingual_path: path.join(temp_dir.path, "bilingual") },
      () => null,
    ),
  ).rejects.toMatchObject({ code: "file.not_found", public_details: { file: "script.rpy" } });
  expect(fs.readdirSync(temp_dir.path)).toEqual([]);
});

configure_python_parser(path.resolve("build/resources/workspace"));

it.each([
  ['"Alice" happy -sad', " happy -sad"],
  ['Character("Alice", image="alice") happy', ', image="alice") happy'],
  ['_("Alice") @ happy', ") @ happy"],
  ['("Al" "ice") happy @ -sad', ") happy @ -sad"],
])("角色属性不进入姓名或正文：%s", async (speaker, suffix) => {
  const lines = [
    "translate schinese start:",
    `    # ${speaker} "Hello."`,
    `    ${speaker} "Hello."`,
  ];
  const format = new RenpyRpyFormat();
  const source = Buffer.from(lines.join("\n"));
  const [item] = await format.read_from_stream(source, "script.rpy");
  expect(item).toMatchObject({ src: "Hello.", name_src: "Alice" });
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rpy-attributes-"));
  await format.write_to_path(
    [{ ...item!, dst: "你好。", name_dst: "爱丽丝", status: "PROCESSED" }],
    { translated_path: temp.path, bilingual_path: temp.path },
    () => source,
  );
  const output = fs.readFileSync(path.join(temp.path, "script.rpy"));
  expect(output.toString().split("\n")[2]).toContain(suffix + ' "你好。"');
  expect(await format.read_from_stream(output, "script.rpy")).toMatchObject([
    { src: "Hello.", name_src: "Alice", dst: "你好。", name_dst: "爱丽丝" },
  ]);
});

it.each([
  ["'Alice'", "Alice"],
  ['"Alice"', "Alice"],
  ["u'艾丽丝'", "艾丽丝"],
  ["r'A\\B'", "A\\B"],
  ["('Al' 'ice')", "Alice"],
  ["_('Alice')", "Alice"],
  ["Character('Alice', color='#fff', callback=handler)", "Alice"],
  ["Character(None, color='#fff')", null],
  ["Character('expr', dynamic=True)", null],
  ["people['Alice']", null],
  ["", null],
  [String.raw`"A\x42  C"`, "AB  C"],
])("姓名按 Python 语义往返，正文和其他参数保持 Ren’Py 语义：%s", async (who, name) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rpy-name-"));
  const source = `translate schinese start:
    # ${who} "Hello.  World" (cb_name="callback")
    ${who} "Hello.  World" (cb_name="callback")`;
  const format = new RenpyRpyFormat();
  const items = await format.read_from_stream(Buffer.from(source), "script.rpy");
  expect(items).toMatchObject([{ src: "Hello. World", name_src: name }]);
  expect(items).toHaveLength(1);
  if (name === null) return;
  const item = items[0]!;
  const name_dst = "爱\\丽\t丝  𠮷";
  await format.write_to_path(
    [{ ...item, dst: item.src, name_dst, status: "PROCESSED" }],
    { translated_path: temp.path, bilingual_path: temp.path },
    () => Buffer.from(source),
  );
  const bytes = fs.readFileSync(path.join(temp.path, "script.rpy"));
  expect(bytes.toString()).toContain('(cb_name="callback")');
  if (who.includes("color"))
    expect(bytes.toString().split("\n")[2]).toContain("color='#fff', callback=handler");
  const reread = await format.read_from_stream(bytes, "script.rpy");
  expect(reread).toMatchObject([{ src: item.src, dst: item.src, name_src: name, name_dst }]);
});

it("v1 单引号姓名前的旧正文槽位从原稿重建后仍可导出", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rpy-v1-"));
  const template = `    # 'Alice' "Hello"`;
  const source = `translate schinese start:
${template}
    'Alice' "Hello"`;
  const item = create_item({
    file_type: "RENPY_RPY",
    file_path: "script.rpy",
    row: 2,
    src: "Hello",
    dst: "你好",
    status: "PROCESSED",
    extra_field: {
      renpy_rpy: {
        v: 1,
        block: { lang: "schinese", label: "start", kind: "LABEL", header_line: 1 },
        pair: { template_line: 2, target_line: 3 },
        slots: [{ role: "DIALOGUE", lit_index: 0 }],
        digest: {
          template_raw_sha1: sha1_hex(template),
          template_raw_rstrip_sha1: sha1_hex(template),
          target_skeleton_sha1: sha1_hex(`'Alice' "{}"`),
          target_string_count: 1,
        },
      },
    },
  });
  const format = new RenpyRpyFormat();
  await format.write_to_path(
    [item],
    { translated_path: temp.path, bilingual_path: temp.path },
    () => Buffer.from(source),
  );
  const output = await format.read_from_stream(
    fs.readFileSync(path.join(temp.path, "script.rpy")),
    "script.rpy",
  );
  expect(output).toMatchObject([{ src: "Hello", dst: "你好", name_src: "Alice", name_dst: null }]);
  expect(item.name_src).toBeNull();
});
