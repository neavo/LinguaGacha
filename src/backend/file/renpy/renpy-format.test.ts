import { GameDirectoryOperations } from "../shared/game/game-directory-operations";
import { read_renpy_metadata } from "./item";
import { PythonSession } from "./python-syntax";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { GameFormat, GAME_METADATA_MEMBER, read_game_container } from "../shared/game/format";
import { create_renpy_adapter } from "./renpy-format";
import { build_renpy_metadata, collect_renpy_files, discover_renpy_source } from "./source";
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
} from "../../../test/renpy-fixture";
import { pickle_string } from "./pickle";
import { extract_script } from "./extract";
import { encode_python } from "./python";

it("独立代码写回只解析目标脚本，空译文导出只更新生成资源", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-export-dependencies-"));
  const native = create_renpy_fixture(temp.path);
  const game = (await discover_renpy_source(temp.path, native))!;
  const data = collect_renpy_files(game, native);
  const format = new GameFormat(new GameDirectoryOperations(), create_renpy_adapter(), native);
  const content = await format.create_container(
    data,
    "demo.renpy",
    "",
    undefined,
    await build_renpy_metadata(game, { data, complete: true }, native),
  );
  const parsed = await format.read_from_stream(content, "demo.renpy");
  const code = parsed.items.find((item) => read_renpy_metadata(item.extra_field).usage === "code")!;
  const { input } = await read_game_container(content, "demo.renpy", true);
  const target = read_renpy_metadata(code.extra_field).internal_file_path;
  const extra = {
    ...input.get(target)!,
    async: vi.fn(async () => {
      throw new Error("unrelated script must not be parsed");
    }),
  };
  const files = new Map(input);
  files.set("game/unrelated.rpyc", extra);
  const handler = await create_renpy_adapter().create_members(files);
  const generated = await handler.prepare_export!([
    { ...code, status: "PROCESSED", dst: "独立代码" },
  ]);
  expect(extra.async).not.toHaveBeenCalled();
  expect(generated.has(RENPY_LANGUAGE_FILE)).toBe(true);
  const rendered = await handler.render(await input.get(target)!.async("uint8array"), target, []);
  using session = await PythonSession.create();
  expect(
    (await extract_script(rendered, false, session)).candidates.some(
      (candidate) => candidate.text === "独立代码",
    ),
  ).toBe(true);
  extra.async.mockClear();
  const empty = await create_renpy_adapter().create_members(files);
  expect((await empty.prepare_export!([])).get(RENPY_STRINGS_FILE)).toBeDefined();
  expect(extra.async).not.toHaveBeenCalled();
});

it.each(["6.99.8", "8.0.3"])("%s 离线重载、人工放行与重复导出共用固化资产", async (version) => {
  using session = await PythonSession.create();
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
    await build_renpy_metadata(game, { data, complete: true }, native),
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
    (await extract_script(first, version.startsWith("6."), session)).candidates.map(
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
    await build_renpy_metadata(game, { data, complete: true }, native),
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
  using session = await PythonSession.create();
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
  const table = (
    await extract_script(
      native.read_file(path.join(out, "demo/game/strings.rpymc")),
      false,
      session,
    )
  ).strings;
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
  using session = await PythonSession.create();
  const output = await extract_script(
    native.read_file(path.join(context.paths.translated_path, "demo/game/compat.rpyc")),
    false,
    session,
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
  using session = await PythonSession.create();
  const output = (file: string) =>
    native.read_file(path.join(context.paths.translated_path, "demo/game", file));
  expect(
    (await extract_script(output("quality.rpyc"), false, session)).candidates.map(
      (candidate) => candidate.text,
    ),
  ).toEqual(["你好 %d", 'f"嗨 {nickname!r}"']);
  expect(
    (await extract_script(output("script.rpyc"), false, session)).candidates.some(
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

/** 对白身份与 who 表达式由测试独立构造。 */
function speaker_say(who: string | Buffer, serial: number, what = `Line ${serial}`): Buffer {
  return object(
    "Say",
    dictionary({
      name: tuple(pickle_string("game/dialogue.rpy"), opcode(0x4b, 1), opcode(0x4b, serial)),
      who: typeof who === "string" ? pickle_string(who) : who,
      what: pickle_string(what),
    }),
  );
}

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
  using session = await PythonSession.create();
  const output = await extract_script(
    native.read_file(path.join(context.paths.translated_path, "demo/game/dialogue.rpyc")),
    false,
    session,
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

it("槽位说话者不一致时保留正文唯一写入口和独立姓名", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-speaker-slots-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "game/dialogue.rpyc"),
    compiled_slots([[speaker_say("'Alice'", 1)], [speaker_say("'Beth'", 1)]]),
  );
  const { items } = await import_fixture(temp.path, native);
  expect(items.filter((item) => item.src === "Line 1")).toHaveLength(1);
  expect(items.find((item) => item.src === "Line 1")!.name_src).toBeNull();
});

it.each(["Hello", "Alice"])("字符串表拥有 %s 的唯一写入口", async (text) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-speaker-table-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "game/dialogue.rpyc"),
    compiled_nodes([speaker_say("'Alice'", 1, "Hello")]),
  );
  native.write_file_sync(
    path.join(temp.path, "game/table.rpyc"),
    strings_fixture([{ language: null, old: text, text: "Base text" }]),
  );
  const { items } = await import_fixture(temp.path, native);
  expect(items.some((item) => item.src === text)).toBe(false);
  expect(items.every((item) => item.name_src === null)).toBe(true);
  expect(items.some((item) => item.src === "Base text")).toBe(true);
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
  using session = await PythonSession.create();
  const original = await extract_script(bytes, false, session);
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
  const output = await extract_script(
    native.read_file(path.join(context.paths.translated_path, "demo/game/characters.rpyc")),
    false,
    session,
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
  using session = await PythonSession.create();
  const output = await extract_script(
    native.read_file(path.join(context.paths.translated_path, "demo/game/dialogue.rpyc")),
    false,
    session,
  );
  expect(output.candidates.map((candidate) => candidate.text)).toEqual(
    expect.arrayContaining(["甲", "乙", "Line 1", "Line 2"]),
  );
});
