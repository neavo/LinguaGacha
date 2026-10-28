import { GameDirectoryOperations } from "../shared/game/game-directory-operations";
import { read_renpy_metadata } from "./item";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import type { Item } from "../../../domain/item";
import { NativeFs } from "../../../native/native-fs";
import { GameFormat, GAME_METADATA_MEMBER } from "../shared/game/format";
import { create_renpy_adapter } from "./renpy-format";
import { collect_renpy_files, discover_renpy_source } from "./source";
import { RENPY_LANGUAGE_FILE, RENPY_STRINGS_FILE } from "./generated";
import {
  create_renpy_fixture,
  compiled_fixture,
  strings_fixture,
  code_fixture,
  compiled_nodes,
  compiled_slots,
  dictionary,
  object,
  opcode,
  tuple,
  extract_fixture,
  import_metadata,
  speaker_say,
} from "../../../test/renpy-fixture";
import { pickle_string } from "./pickle";
import { encode_python } from "./python";

it("独立代码只分析目标成员，无关坏成员按原字节输出，正文改动依赖完整字符串表", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-export-dependencies-"));
  const native = create_renpy_fixture(temp.path);
  const { format, items, context } = await import_fixture(temp.path, native);
  const game = (await discover_renpy_source(temp.path, native))!;
  const data = collect_renpy_files(game, native);
  const broken = Buffer.from("not a compiled script");
  const asset = await format.create_container(
    new Map([...data, ["game/unrelated.rpyc", broken]]),
    "demo.renpy",
    "",
    undefined,
    await import_metadata(game, data, native),
  );
  const broken_context = { ...context, asset_reader: () => Buffer.from(asset) };
  const out = (name: string) =>
    native.read_file(path.join(context.paths.translated_path, "demo", name));
  const code = items.find((item) => read_renpy_metadata(item.extra_field).usage === "code")!;
  await format.write_to_path([{ ...code, status: "PROCESSED", dst: "独立代码" }], broken_context);
  expect(out("game/unrelated.rpyc")).toEqual(broken);
  expect(
    (await extract_fixture(out("game/script.rpyc"))).candidates.some(
      (candidate) => candidate.text === "独立代码",
    ),
  ).toBe(true);
  await format.write_to_path([], broken_context);
  expect(out("game/script.rpyc")).toEqual(compiled_fixture());
  expect(Buffer.from(out(RENPY_STRINGS_FILE)).toString()).not.toContain("translate");
  const say = items.find((item) => read_renpy_metadata(item.extra_field).usage === "say")!;
  await expect(
    format.write_to_path([{ ...say, status: "PROCESSED", dst: "正文" }], broken_context),
  ).rejects.toThrow("Cannot index Ren'Py member game/unrelated.rpyc");
  await format.write_to_path([{ ...say, status: "PROCESSED", dst: say.src }], broken_context);
  expect(out("game/script.rpyc")).toEqual(compiled_fixture());
});

it.each(["6.99.8", "8.0.3"])("%s 离线重载、人工放行与重复导出共用固化资产", async (version) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-format-"));
  const root = path.join(temp.path, "original"),
    native = create_renpy_fixture(root);
  native.write_file_sync(
    path.join(root, "renpy/__init__.py"),
    "version_tuple = (" + version.split(".").join(", ") + ", 0)\n",
  );
  if (version.startsWith("6."))
    fs.renameSync(path.join(root, "lib/py3-windows-x86_64"), path.join(root, "lib/windows-i686"));
  const game = (await discover_renpy_source(root, native))!;
  const data = collect_renpy_files(game, native);
  const format = new GameFormat(new GameDirectoryOperations(), create_renpy_adapter(), native);
  const container = await format.create_container(
    data,
    "demo.renpy",
    [...data.keys()].join("\n"),
    undefined,
    await import_metadata(game, data, native),
  );
  fs.renameSync(root, path.join(temp.path, "unavailable"));
  const parsed = await new GameFormat(
    new GameDirectoryOperations(),
    create_renpy_adapter(),
    native,
  ).read_from_stream(container, "demo.renpy");
  expect(parsed.warnings).toEqual([]);
  const display = parsed.items.find((item) => item.src === "First line [lg_name].")!;
  const code = parsed.items.find((item) => item.status === "RULE_SKIPPED")!;
  const common = parsed.items.find((item) => item.src === "Common question?")!;
  const items = [
    { ...display, status: "PROCESSED" as const, dst: "首句 [lg_name]。" },
    { ...code, status: "PROCESSED" as const, dst: "人工放行" },
    { ...common, status: "PROCESSED" as const, dst: "公共问题？" },
  ];
  const out = path.join(temp.path, "out");
  const context = {
    paths: { translated_path: out, bilingual_path: out },
    source_files: [{ path: "demo.renpy", file_type: "RENPY" }],
    asset_reader: () => Buffer.from(container),
  };
  await format.write_to_path(items, context);
  const first = native.read_file(path.join(out, "demo/game/script.rpyc"));
  const generated = native.read_text_file(path.join(out, "demo", RENPY_LANGUAGE_FILE));
  expect(
    (await extract_fixture(first, version.startsWith("6."))).candidates.map(
      (candidate) => candidate.text,
    ),
  ).toEqual(expect.arrayContaining(["首句 [lg_name]。", "人工放行"]));
  expect(native.read_text_file(path.join(out, "demo", RENPY_STRINGS_FILE))).toContain(
    encode_python("公共问题？").slice(1),
  );
  expect(native.read_text_file(path.join(out, "demo", RENPY_STRINGS_FILE))).toContain(
    'old "Common question?"',
  );
  await format.write_to_path(items, context);
  expect(native.read_file(path.join(out, "demo/game/script.rpyc"))).toEqual(first);
  expect(native.read_text_file(path.join(out, "demo", RENPY_LANGUAGE_FILE))).not.toBe(generated);
  await format.write_to_path([], context);
  expect(native.read_file(path.join(out, "demo/game/script.rpyc"))).toEqual(compiled_fixture());
  expect(native.read_text_file(path.join(out, "demo", RENPY_STRINGS_FILE))).not.toContain(
    "translate",
  );
  expect(native.exists(path.join(out, "demo", GAME_METADATA_MEMBER))).toBe(false);
});

/** 固化测试游戏并读出条目，导出上下文指向临时输出目录。 */
async function import_fixture(root: string, native: ReturnType<typeof create_renpy_fixture>) {
  const game = (await discover_renpy_source(root, native))!;
  const data = collect_renpy_files(game, native);
  const format = new GameFormat(new GameDirectoryOperations(), create_renpy_adapter(), native);
  const asset = await format.create_container(
    data,
    "demo.renpy",
    [...data.keys()].join("\n"),
    undefined,
    await import_metadata(game, data, native),
  );
  const parsed = await format.read_from_stream(asset, "demo.renpy");
  const out = path.join(root, "out");
  const context = {
    paths: { translated_path: out, bilingual_path: out },
    source_files: [{ path: "demo.renpy", file_type: "RENPY" }],
    asset_reader: () => Buffer.from(asset),
  };
  return { format, ...parsed, context };
}

it.each(["digest", "key", "src"] as const)("失效 %s 在落盘前失败", async (field) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-stale-"));
  const native = create_renpy_fixture(temp.path);
  const { format, items, context } = await import_fixture(temp.path, native);
  const item = items.find((entry) => entry.src.startsWith("First line"))!;
  const location = read_renpy_metadata(item.extra_field);
  const invalid = {
    ...item,
    dst: "译文",
    status: "PROCESSED" as const,
    ...(field === "src"
      ? { src: "stale" }
      : {
          extra_field: {
            renpy: { ...location, [field]: field === "digest" ? "b".repeat(64) : "stale" },
          },
        }),
  };
  await expect(format.write_to_path([invalid], context)).rejects.toThrow(
    field === "digest" ? "digest changed" : "candidate changed",
  );
  expect(native.exists(context.paths.translated_path)).toBe(false);
});
it("跨成员 None 字符串写 new，保留语言按新键重映射并拒绝冲突", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-strings-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "game/paragraph.rpyc"),
    code_fixture("message = _p('A  B')"),
  );
  native.write_file_sync(
    path.join(temp.path, "game/strings.rpymc"),
    strings_fixture([
      { language: null, old: "Common question?", text: "Existing base text" },
      { language: "french", old: "First line [lg_name].", text: "French text" },
      { language: "french", old: "Occupied", text: "Different text" },
      { language: "french", old: "A  B", text: "French paragraph" },
    ]),
  );
  const { format, items, context } = await import_fixture(temp.path, native);
  expect(items.some((item) => item.src === "Common question?")).toBe(false);
  const base = items.find((item) => item.src === "Existing base text")!;
  const display = items.find((item) => item.src === "First line [lg_name].")!;
  const paragraph = items.find((item) => item.src === "A  B")!;
  const out = context.paths.translated_path;
  await format.write_to_path(
    [
      { ...base, status: "PROCESSED", dst: "基础译文" },
      { ...display, status: "PROCESSED", dst: "Translated [lg_name]." },
      { ...paragraph, status: "PROCESSED", dst: "C  D" },
    ],
    context,
  );
  const table = (await extract_fixture(native.read_file(path.join(out, "demo/game/strings.rpymc"))))
    .strings;
  expect(table).toContainEqual(
    expect.objectContaining({ language: null, old: "Common question?", text: "基础译文" }),
  );
  const generated = native.read_text_file(path.join(out, "demo", RENPY_STRINGS_FILE));
  expect(generated).toContain("translate french strings:");
  expect(generated).toContain('old "Translated [lg_name]."');
  expect(generated).toContain('new "French text"');
  expect(generated).toContain('old "C  D"');
  expect(generated).toContain('new "French paragraph"');
  await expect(
    format.write_to_path([{ ...display, status: "PROCESSED", dst: "Occupied" }], context),
  ).rejects.toThrow("Conflicting generated");
});

it("以旧用途保存的条目按位置找回，导出按本次解析的用途维护其他语言映射", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-usage-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "game/strings.rpymc"),
    strings_fixture([{ language: "french", old: "First line [lg_name].", text: "French text" }]),
  );
  const { format, items, context } = await import_fixture(temp.path, native);
  const say = items.find((item) => item.src === "First line [lg_name].")!;
  const stale = {
    ...say,
    status: "PROCESSED" as const,
    dst: "Translated [lg_name].",
    extra_field: {
      renpy: { ...(say.extra_field as { renpy: object }).renpy, usage: "code" },
    },
  };
  await format.write_to_path([stale], context);
  const generated = native.read_text_file(
    path.join(context.paths.translated_path, "demo", RENPY_STRINGS_FILE),
  );
  expect(generated).toContain('old "Translated [lg_name]."');
  expect(generated).toContain('new "French text"');
});

it("固定的旧条目身份仍可导出，重新提取得到新增条目", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-legacy-keys-"));
  const native = create_renpy_fixture(temp.path);
  const bytes = code_fixture(
    'asset = prefix + " suffix"\ngreet = _("Hello") + name\nlabel = f"Hi {name}"',
  );
  native.write_file_sync(path.join(temp.path, "game/compat.rpyc"), bytes);
  const { format, items, warnings, extraction_complete, context } = await import_fixture(
    temp.path,
    native,
  );
  expect(warnings).toEqual([]);
  expect(extraction_complete).toBe(true);
  expect(
    items
      .filter(
        (item) => read_renpy_metadata(item.extra_field).internal_file_path === "game/compat.rpyc",
      )
      .map((item) => [item.src, item.status]),
  ).toEqual([
    [" suffix", "RULE_SKIPPED"],
    ["Hello", "NONE"],
    ['f"Hi {name}"', "RULE_SKIPPED"],
  ]);
  const template = items.find((item) => item.src.startsWith("First line"))!;
  const legacy = {
    ...template,
    src: " suffix",
    dst: " 后缀",
    name_src: null,
    name_dst: null,
    status: "PROCESSED" as const,
    extra_field: {
      renpy: {
        internal_file_path: "game/compat.rpyc",
        digest: createHash("sha256").update(bytes).digest("hex"),
        // 旧版本提取器产生的身份，按字面量固定。
        key: JSON.stringify([JSON.stringify(["game/test.rpy", "1", "1"]), "code", 17, " suffix"]),
        usage: "code",
      },
    },
  };
  await format.write_to_path([legacy], context);
  const output = await extract_fixture(
    native.read_file(path.join(context.paths.translated_path, "demo/game/compat.rpyc")),
  );
  expect(output.candidates.map((candidate) => candidate.text)).toEqual([
    " 后缀",
    "Hello",
    'f"Hi {name}"',
  ]);
});

it("生成阶段不判断译文质量：格式记号、文本标签和源码表达式的变化照常写回", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-quality-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "game/quality.rpyc"),
    code_fixture('a = Text("Hello %s %%" % name)\nb = f"Hi {name}"'),
  );
  const { format, items, context } = await import_fixture(temp.path, native);
  const translate = (src: string, dst: string) => ({
    ...items.find((entry) => entry.src === src)!,
    status: "PROCESSED" as const,
    dst,
  });
  await format.write_to_path(
    [
      translate("Hello %s %%", "你好 %d"),
      translate('f"Hi {name}"', 'f"嗨 {nickname!r}"'),
      translate("First line [lg_name].", "首句 [lg_name。{#context}"),
    ],
    context,
  );
  const output = (file: string) =>
    native.read_file(path.join(context.paths.translated_path, "demo/game", file));
  expect(
    (await extract_fixture(output("quality.rpyc"))).candidates.map((candidate) => candidate.text),
  ).toEqual(["你好 %d", 'f"嗨 {nickname!r}"']);
  expect(
    (await extract_fixture(output("script.rpyc"))).candidates.some(
      (candidate) => candidate.text === "首句 [lg_name。{#context}",
    ),
  ).toBe(true);
});

it("Ren'Py 配套输出提交失败后恢复整个资产", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-rollback-"));
  const native = create_renpy_fixture(temp.path);
  const { format, items, context } = await import_fixture(temp.path, native);
  const directory = path.join(context.paths.translated_path, "demo");
  const old = new Map([
    ["game/script.rpyc", Buffer.from("old script")],
    [RENPY_LANGUAGE_FILE, Buffer.from("old language")],
    ["notes.txt", Buffer.from("unrelated")],
  ]);
  for (const [name, bytes] of old) native.write_file_sync(path.join(directory, name), bytes);
  const rename = native.rename.bind(native);
  vi.spyOn(native, "rename").mockImplementation((from, to) => {
    if (
      from.includes(path.sep + "stage" + path.sep) &&
      to.endsWith(path.normalize(RENPY_STRINGS_FILE))
    )
      throw new Error("injected commit failure");
    rename(from, to);
  });
  const item = items.find((item) => item.src.startsWith("First line"))!;
  await expect(
    format.write_to_path([{ ...item, status: "PROCESSED", dst: "译文 [lg_name]。" }], context),
  ).rejects.toThrow("injected");
  for (const [name, bytes] of old)
    expect(native.read_file(path.join(directory, name))).toEqual(bytes);
  expect(native.exists(path.join(directory, RENPY_STRINGS_FILE))).toBe(false);
  expect(native.exists(path.join(directory, ".tmp"))).toBe(false);
});

it.each([
  ["'Alice'", "Alice"],
  ["('Al' 'ice')", "Alice"],
  ["Character('Alice', color='#fff')", "Alice"],
  ["Character('expr', dynamic=True)", null],
  ["protagonist", null],
])("只提取当前语句的明确姓名：%s", async (who, expected) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-speaker-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "game/characters.rpyc"),
    code_fixture("protagonist = Character('Defined Alice')"),
  );
  native.write_file_sync(
    path.join(temp.path, "game/dialogue.rpyc"),
    compiled_slots([[speaker_say(who, 1)], [speaker_say(who, 1)]]),
  );
  const { items, format, context } = await import_fixture(temp.path, native);
  const dialogue = items.find((item) => item.src === "Line 1")!;
  expect(dialogue.name_src).toBe(expected);
  expect(items.find((item) => item.src === "Defined Alice")).toMatchObject({
    name_src: null,
    status: "NONE",
  });
  if (!expected) return;
  expect(items.some((item) => item.src === expected)).toBe(false);
  await format.write_to_path(
    [{ ...dialogue, dst: dialogue.src, name_dst: "爱丽丝", status: "PROCESSED" }],
    context,
  );
  const output = await extract_fixture(
    native.read_file(path.join(context.paths.translated_path, "demo/game/dialogue.rpyc")),
  );
  expect(output.candidates).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        text: "爱丽丝",
        coordinates: [expect.objectContaining({ slot: 1 }), expect.objectContaining({ slot: 2 })],
      }),
      expect.objectContaining({ text: "Line 1" }),
    ]),
  );
  if (who.includes("color"))
    expect(output.candidates.some((candidate) => candidate.text === "#fff")).toBe(true);
  await expect(
    format.write_to_path(
      [{ ...dialogue, dst: dialogue.src, name_src: "stale", name_dst: "错", status: "PROCESSED" }],
      context,
    ),
  ).rejects.toThrow("speaker original changed");
});

it("旧独立姓名和旧动态表达式保留候选身份及人工导出资格", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-speaker-legacy-"));
  const native = create_renpy_fixture(temp.path);
  const bytes = code_fixture(
    "protagonist = Character('Alice')\ndynamic = Character('expression', dynamic=True)",
  );
  native.write_file_sync(path.join(temp.path, "game/characters.rpyc"), bytes);
  native.write_file_sync(
    path.join(temp.path, "game/dialogue.rpyc"),
    compiled_nodes([speaker_say("protagonist", 1)]),
  );
  const { items, format, context } = await import_fixture(temp.path, native);
  const original = await extract_fixture(bytes);
  const dialogue = items.find((item) => item.src === "Line 1")!;
  const legacy = original.candidates.map((candidate, index) => ({
    ...dialogue,
    row: 100 + index,
    src: candidate.text,
    dst: index === 0 ? "旧姓名" : "legacy_expression",
    name_src: null,
    name_dst: null,
    status: "PROCESSED" as const,
    extra_field: {
      renpy: {
        internal_file_path: "game/characters.rpyc",
        digest: original.digest,
        key: candidate.key,
        usage: "display",
      },
    },
  }));
  await format.write_to_path(legacy, context);
  const output = await extract_fixture(
    native.read_file(path.join(context.paths.translated_path, "demo/game/characters.rpyc")),
  );
  expect(output.candidates.map((candidate) => candidate.text)).toEqual([
    "旧姓名",
    "legacy_expression",
  ]);
});

it.each([false, true])("共享姓名消费边只在完整正文写入组内开放：%s", async (shared) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-name-consumers-"));
  const native = create_renpy_fixture(temp.path);
  const expression = Buffer.concat([
    Buffer.from("crenpy.astsupport\nPyExpr\n"),
    tuple(pickle_string("'Alice'")),
    opcode(0x52, 0x71, 0),
  ]);
  native.write_file_sync(
    path.join(temp.path, "game/dialogue.rpyc"),
    compiled_nodes([
      speaker_say(shared ? expression : "'Alice'", 1),
      speaker_say(shared ? opcode(0x68, 0) : "'Alice'", 2),
    ]),
  );
  const { items, format, context } = await import_fixture(temp.path, native);
  const lines = items.filter((item) => item.src === "Line 1" || item.src === "Line 2");
  expect(lines.map((item) => item.name_src)).toEqual(shared ? [null, null] : ["Alice", "Alice"]);
  expect(items.filter((item) => item.src === "Alice")).toHaveLength(shared ? 1 : 0);
  if (shared) return;
  await format.write_to_path(
    lines.map((item, index) => ({
      ...item,
      dst: item.src,
      name_dst: index ? "乙" : "甲",
      status: "PROCESSED",
    })),
    context,
  );
  const output = await extract_fixture(
    native.read_file(path.join(context.paths.translated_path, "demo/game/dialogue.rpyc")),
  );
  expect(output.candidates.map((candidate) => candidate.text)).toEqual(
    expect.arrayContaining(["甲", "乙", "Line 1", "Line 2"]),
  );
});

/** 直接固化测试成员与指定元数据，模拟历史原稿。 */
async function metadata_asset(
  members: ReadonlyMap<string, Buffer>,
  metadata: Readonly<Record<string, unknown>>,
) {
  const native = new NativeFs();
  const format = new GameFormat(new GameDirectoryOperations(), create_renpy_adapter(), native);
  const metadata_bytes = Buffer.from(
    JSON.stringify({
      schema: "linguagacha-renpy-1",
      engine_version: "test",
      python_major: 3,
      common: [],
      ...metadata,
    }),
  );
  const asset = await format.create_container(
    members,
    "demo.renpy",
    [...members.keys()].join("\n"),
    undefined,
    metadata_bytes,
  );
  /** 导出到临时目录并读回指定成员。 */
  const write = async (out: string, items: Item[]) => {
    await format.write_to_path(items, {
      paths: { translated_path: out, bilingual_path: out },
      source_files: [{ path: "demo.renpy", file_type: "RENPY" }],
      asset_reader: () => Buffer.from(asset),
    });
    return (name: string) => native.read_file(path.join(out, "demo", name));
  };
  return { format, asset, metadata_bytes, write };
}
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const menu_node = (label: string) =>
  object(
    "Menu",
    dictionary({
      name: tuple(pickle_string("game/menu.rpy"), opcode(0x4b, 1), opcode(0x4b, 1)),
      items: tuple(tuple(pickle_string(label), pickle_string("True"), tuple())),
    }),
  );

it("历史未知百分号语义按默认值导出旧菜单，其他语言改用新键，基础语言表与公共条目照常导出", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-legacy-menu-"));
  const menu = compiled_nodes([menu_node("Progress 100%%")]);
  const members = new Map([
    ["game/menu.rpyc", menu],
    [
      "game/strings.rpyc",
      strings_fixture([
        { language: null, old: "Progress 100%", text: "Base progress" },
        { language: "french", old: "Progress 100%", text: "Progrès 100%" },
      ]),
    ],
  ]);
  const { format, asset, metadata_bytes, write } = await metadata_asset(members, {
    old_substitutions: null,
    common: ["Common question?"],
  });
  const { items } = await format.read_from_stream(asset, "demo.renpy");
  // 按当前规则重新提取时，菜单由已有的基础语言字符串表条目承接。
  expect(items.some((item) => item.src === "Progress 100%%")).toBe(false);
  const base = items.find((item) => item.src === "Base progress")!;
  const common = items.find((item) => item.src === "Common question?")!;
  expect(read_renpy_metadata(common.extra_field).digest).toBe(sha256(metadata_bytes));
  const candidate = (await extract_fixture(menu)).candidates[0]!;
  const legacy_menu: Item = {
    ...base,
    src: candidate.text,
    status: "PROCESSED",
    dst: "进度 100%",
    extra_field: {
      renpy: {
        internal_file_path: "game/menu.rpyc",
        digest: sha256(menu),
        usage: "menu",
        key: candidate.key,
      },
    },
  };
  const output = await write(path.join(temp.path, "out"), [
    legacy_menu,
    { ...base, status: "PROCESSED", dst: "基础进度" },
    { ...common, status: "PROCESSED", dst: "公共问题？" },
  ]);
  expect((await extract_fixture(output("game/menu.rpyc"))).candidates[0]!.text).toBe("进度 100%%");
  expect((await extract_fixture(output("game/strings.rpyc"))).strings).toContainEqual({
    language: null,
    old: "Progress 100%",
    text: "基础进度",
  });
  const generated = Buffer.from(output(RENPY_STRINGS_FILE)).toString();
  const mapping = (language: string, old: string, text: string) =>
    `translate ${language} strings:\n    old ${encode_python(old).slice(1)}\n    new ${encode_python(text).slice(1)}`;
  expect(generated).toContain(mapping("french", "进度 100%", "Progrès 100%"));
  expect(generated).toContain(mapping("None", "Common question?", "公共问题？"));
});

it.each([
  [true, "100%% %% %(name)s %%d"],
  [null, "100%% %% %(name)s %%d"],
  [false, "100% %% %(name)s %d"],
])("百分号语义 %s：对白与菜单的译文按引擎替换规则写回", async (old_substitutions, expected) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-percent-"));
  const script = compiled_nodes([
    object(
      "Say",
      dictionary({
        name: tuple(pickle_string("game/say.rpy"), opcode(0x4b, 1), opcode(0x4b, 1)),
        what: pickle_string("Rate"),
      }),
    ),
    menu_node("Choice"),
  ]);
  const { format, asset, write } = await metadata_asset(new Map([["game/script.rpyc", script]]), {
    old_substitutions,
  });
  const { items } = await format.read_from_stream(asset, "demo.renpy");
  expect(items.map((item) => read_renpy_metadata(item.extra_field).usage)).toEqual(["say", "menu"]);
  const output = await write(
    path.join(temp.path, "out"),
    items.map((item) => ({ ...item, status: "PROCESSED", dst: "100% %% %(name)s %d" })),
  );
  expect(
    (await extract_fixture(output("game/script.rpyc"))).candidates.map((entry) => entry.text),
  ).toEqual([expected, expected]);
});

it("NUL 按字段编码写回：对白写入编译文本，代码字面量写作转义", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-nul-"));
  const native = create_renpy_fixture(temp.path);
  const { format, items, context } = await import_fixture(temp.path, native);
  const say = items.find((item) => read_renpy_metadata(item.extra_field).usage === "say")!;
  const code = items.find((item) => item.src === "Program value")!;
  await format.write_to_path(
    [
      { ...say, status: "PROCESSED", dst: "A\0B" },
      { ...code, status: "PROCESSED", dst: "C\0D" },
    ],
    context,
  );
  const output = await extract_fixture(
    native.read_file(path.join(context.paths.translated_path, "demo/game/script.rpyc")),
  );
  expect(output.candidates.map((candidate) => candidate.text)).toEqual(
    expect.arrayContaining(["A\0B", "C\0D"]),
  );
});
