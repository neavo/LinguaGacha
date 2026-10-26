import { GameDirectoryOperations } from "../shared/game/game-directory-operations";
import { read_renpy_metadata } from "./item";
import { PythonSession } from "./python-syntax";
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
} from "../../../test/renpy-fixture";
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
  const { items } = await format.read_from_stream(asset, "demo.renpy");
  const out = path.join(root, "out");
  const context = {
    paths: { translated_path: out, bilingual_path: out },
    source_files: [{ path: "demo.renpy", file_type: "RENPY" }],
    asset_reader: () => Buffer.from(asset),
  };
  return { format, items, context };
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

it("以旧用途保存的条目按位置找回，导出按本次解析的用途校验", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-usage-"));
  const native = create_renpy_fixture(temp.path);
  const { format, items, context } = await import_fixture(temp.path, native);
  const say = items.find((item) => item.src === "First line [lg_name].")!;
  const stale = {
    ...say,
    status: "PROCESSED" as const,
    extra_field: {
      renpy: { ...(say.extra_field as { renpy: object }).renpy, usage: "code" },
    },
  };
  await expect(
    format.write_to_path([{ ...stale, dst: "首句 [lg_name。" }], context),
  ).rejects.toThrow("Unclosed Ren'Py interpolation");
  await format.write_to_path([{ ...stale, dst: "首句 [lg_name]。" }], context);
});

it.each([
  ["Hello %s %%", "你好 %s", false],
  ["Hello %s %%", "你好 %s %%，100%", false],
  ["Hello %s %%", "你好 %s %%", true],
  ["%(a)s and %(b)s", "%(b)s 与 %(a)s", true],
])("`%%` 左操作数 %s 译为 %s 时导出%s", async (src, dst, accepted) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-percent-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "game/percent.rpyc"),
    code_fixture('a = Text("Hello %s %%" % name)\nb = Text("%(a)s and %(b)s" % values)'),
  );
  const { format, items, context } = await import_fixture(temp.path, native);
  const item = { ...items.find((entry) => entry.src === src)!, status: "PROCESSED" as const, dst };
  if (accepted) await format.write_to_path([item], context);
  else
    await expect(format.write_to_path([item], context)).rejects.toThrow(
      "Ren'Py percent format changed",
    );
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
