import { GameDirectoryOperations } from "./shared/game/game-directory-operations";
import { read_resource } from "./godot/resource";
import { read_pack } from "./godot/pack";
import { create_godot_fixture, godot_pack_fixture } from "../../test/godot-fixture";
import { read_godot_metadata } from "./godot/item";
import { read_translation } from "./godot/translation";
import { GAME_METADATA_MEMBER, read_game_container } from "./shared/game/format";
import { evb_fixture } from "../../test/evb-fixture";
import { encrypted_media, MEDIA_KEY, png_fixture } from "../../test/media-fixture";
import { create_pdf_execution } from "./pdf/test-support";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import { spreadsheet_fixture } from "../../test/spreadsheet-fixture";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeFs } from "../../native/native-fs";
import { write_zip } from "../../test/zip-fixture";
import { FileFormatService } from "./file-format-service";
import { PROJECT_SOURCE_FORMATS } from "../../shared/project-source-formats";
import { create_renpy_fixture, compiled_fixture } from "../../test/renpy-fixture";
import { read_renpy_metadata } from "./renpy/item";
import { read_renpy_format_metadata } from "./renpy/profile";

it.each(["script", "additional"])("Ren’Py %s 读取失败按真实依赖保留离线语义", async (failure) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-partial-context-"));
  const root = path.join(temp.path, "game");
  const native = create_renpy_fixture(root);
  const service = new FileFormatService(
    new GameDirectoryOperations(native),
    { target_language: "ZH" },
    async () => null,
    native,
  );
  const entry = (await service.collect_source_file_entries([root]))[0]!;
  const original = await service.prepare_source(entry);
  const original_parsed = await service.parse_asset(entry.rel_path, original.content, "RENPY");
  if (original_parsed.kind !== "items") throw new Error("Expected Ren’Py items");
  // 首次导入直接交付联合分析结果，与离线解析同一份固化原稿的结果一致。
  expect(original.read).toEqual({ ok: true, result: original_parsed });
  const display = original_parsed.items.find(
    (item) => read_renpy_metadata(item.extra_field).usage === "say",
  )!;
  const missing = path.join(root, "game", failure === "script" ? "missing.rpyc" : "notes.json");
  native.write_file_sync(missing, failure === "script" ? compiled_fixture() : "{}");
  const read = native.read_file.bind(native);
  const unavailable = vi.spyOn(native, "read_file").mockImplementation((file) => {
    if (file === missing) throw new Error("original unreadable");
    return read(file);
  });
  const prepared = await service.prepare_source(entry).finally(() => unavailable.mockRestore());
  expect(prepared.diagnostics).toContainEqual(
    expect.objectContaining({ member: "game/" + path.basename(missing) }),
  );
  fs.renameSync(root, path.join(temp.path, "offline"));
  const { input } = await read_game_container(prepared.content, entry.rel_path, true);
  const metadata = read_renpy_format_metadata(
    await input.get(GAME_METADATA_MEMBER)!.async("uint8array"),
  );
  const parsed = await service.parse_asset(entry.rel_path, prepared.content, "RENPY");
  if (parsed.kind !== "items") throw new Error("Expected Ren’Py items");
  expect(prepared.read).toEqual({ ok: true, result: parsed });
  expect(parsed.items.some((item) => read_renpy_metadata(item.extra_field).usage === "say")).toBe(
    failure !== "script",
  );
  expect(metadata.old_substitutions).toBe(true);
  const output = path.join(temp.path, "out");
  const context = {
    paths: { translated_path: output, bilingual_path: output },
    source_files: [{ path: entry.rel_path, file_type: "RENPY" }],
    asset_reader: () => Buffer.from(prepared.content),
  };
  const write = service.write_items([{ ...display, status: "PROCESSED", dst: "译文" }], context);
  if (failure === "script") {
    await expect(write).rejects.toThrow("Incomplete Ren'Py string table");
    expect(metadata.common).toBeNull();
    const code = parsed.items.find(
      (item) => read_renpy_metadata(item.extra_field).usage === "code",
    )!;
    await expect(
      service.write_items([{ ...code, status: "PROCESSED", dst: "代码译文" }], context),
    ).resolves.toBeUndefined();
  } else await expect(write).resolves.toBeUndefined();
});

/**
 * 测试统一使用显式配置，避免依赖用户本机设置
 */
function create_service(): FileFormatService {
  return new FileFormatService(
    new GameDirectoryOperations(),
    {
      target_language: "ZH",
    },
    create_pdf_execution(),
  );
}

it.each(["member", "commit"])("Godot %s 失败仍归档可靠原稿，胜出资源不回退", async (failure) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-partial-"));
  const native = new NativeFs(),
    pack = path.join(temp.path, "game.pck");
  const files = create_godot_fixture();
  native.write_file_sync(pack, godot_pack_fixture(files));
  if (failure === "member") {
    const handle = await native.open_file(pack, "r+");
    try {
      const member = (await read_pack(handle)).members.find(
        (member) => member.name === "main.gdc",
      )!;
      await handle.write(Buffer.from([255]), 0, 1, member.offset);
    } finally {
      await handle.close();
    }
    native.write_file_sync(path.join(temp.path, "main.gdc"), "old loser");
  } else {
    const rename = native.rename.bind(native);
    vi.spyOn(native, "rename").mockImplementation((from, to) => {
      if (from.includes(path.sep + "stage" + path.sep) && to.endsWith("project.binary"))
        throw new Error("commit failed");
      rename(from, to);
    });
  }
  const original = native.read_file(pack);
  const service = new FileFormatService(
    new GameDirectoryOperations(),
    { target_language: "ZH" },
    async () => null,
    native,
  );
  const prepared = await service.prepare_source(
    (await service.collect_source_file_entries([temp.path]))[0]!,
  );
  expect(prepared.directory_changed).toBe(false);
  expect(native.read_file(pack)).toEqual(original);
  const container = await read_game_container(prepared.content, "game.godot");
  expect(container.members.has("project.binary")).toBe(true);
  expect(container.members.has("main.gdc")).toBe(failure === "commit");
});

describe("FileFormatService", () => {
  it("目录占用入口的读取失败仍按单个来源归集，保留正常文件", async () => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-stat-failure-"));
    const native = new NativeFs();
    const bad = path.join(temp.path, "game.exe");
    const good = path.join(temp.path, "good.txt");
    fs.writeFileSync(bad, "launcher");
    fs.writeFileSync(good, "正文");
    const stat = native.stat.bind(native);
    vi.spyOn(native, "stat").mockImplementation((file) => {
      if (file === bad) throw new Error("stat denied");
      return stat(file);
    });
    const service = new FileFormatService(
      new GameDirectoryOperations(native),
      { target_language: "ZH" },
      create_pdf_execution(),
      native,
    );
    const result = await service.summarize_source_files([bad, good]);
    expect(result.source_file_count).toBe(1);
  });

  it("已展开游戏的零包预览也检查正式执行前新增的包", async () => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-empty-pack-preview-"));
    const native = new NativeFs(),
      service = create_service();
    for (const [name, bytes] of create_godot_fixture())
      native.write_file_sync(path.join(temp.path, name), bytes);
    const preview = await service.summarize_source_files([temp.path]);
    expect(preview.godot_packs?.[0]?.external_pcks).toEqual([]);
    native.write_file_sync(
      path.join(temp.path, "extra.pck"),
      godot_pack_fixture(create_godot_fixture()),
    );
    await expect(
      service.collect_source_file_entries([temp.path], undefined, [
        { game_root: temp.path, ordered_pcks: [] },
      ]),
    ).rejects.toMatchObject({
      code: "request.validation_failed",
      public_details: { action: "refresh_godot_packs" },
    });
    expect(native.exists(path.join(temp.path, "backup_lg"))).toBe(false);
  });

  it("JSON 分发保留编码、标准语法和已保存格式身份的接受范围", async () => {
    const service = create_service();
    const encoded = iconv.encode(JSON.stringify({ café: "élève" }), "windows-1252");
    expect(await service.parse_asset("legacy.json", encoded)).toMatchObject({
      file_type: "KVJSON",
      items: [{ src: "café", dst: "élève" }],
    });
    expect(
      await service.parse_asset("bom.json", Buffer.from('\uFEFF[{"message":"正文"}]')),
    ).toMatchObject({ file_type: "MESSAGEJSON", items: [{ src: "正文" }] });
    const historical = Buffer.from('{"extra": NaN, "原文":"译文"}');
    await expect(service.parse_asset("new.json", historical)).rejects.toThrow(SyntaxError);
    expect(await service.parse_asset("saved.json", historical, "KVJSON")).toMatchObject({
      file_type: "KVJSON",
      items: [{ src: "原文", dst: "译文" }],
    });
    expect(
      await service.parse_asset("saved.json", Buffer.from('[{"message":"正文"}]'), "KVJSON"),
    ).toMatchObject({ file_type: "KVJSON", items: [] });
    await expect(
      service.parse_asset("broken.json", Buffer.from("{"), "MESSAGEJSON"),
    ).rejects.toThrow(SyntaxError);
  });

  it("游戏独占输出目录，整批导出在首次写入前拒绝目录内的普通资产", async () => {
    const native = new NativeFs();
    const write = vi.spyOn(native, "write_file").mockResolvedValue();
    const service = new FileFormatService(
      new GameDirectoryOperations(),
      { target_language: "ZH" },
      create_pdf_execution(),
      native,
    );
    const bytes = await write_zip(new Map([["data/Actors.json", "[]"]]));
    await expect(
      service.write_items([], {
        paths: { translated_path: "out", bilingual_path: "bilingual" },
        source_files: [
          { path: "game.zip", file_type: "RPGMAKER_MV_MZ" },
          { path: "game/readme.txt", file_type: "TXT" },
        ],
        asset_reader: () => bytes,
      }),
    ).rejects.toMatchObject({ code: "request.validation_failed" });
    expect(write).not.toHaveBeenCalled();
  });

  it("同批同名游戏使用同一本地时间，避让已有与候选的时间戳名称", () => {
    const paths = create_service()
      .assign_source_file_paths(
        [
          { source_path: "a", rel_path: "game.zip", file_type: "RPGMAKER_MV_MZ" },
          { source_path: "b", rel_path: "game.zip", file_type: "RPGMAKER_MV_MZ" },
          { source_path: "c", rel_path: "game.zip", file_type: "RPGMAKER_MV_MZ" },
          { source_path: "d", rel_path: "game_20261011_123456_2.zip", file_type: "RPGMAKER_MV_MZ" },
        ],
        [
          { path: "game_20261011_123456.zip", file_type: "RPGMAKER_MV_MZ" },
          { path: "game_2.zip", file_type: "RPGMAKER_MV_MZ" },
        ],
      )
      .map((entry) => entry.rel_path);
    expect(paths).toEqual([
      "game.zip",
      "game_20261011_123456_3.zip",
      "game_20261011_123456_4.zip",
      "game_20261011_123456_2.zip",
    ]);
  });

  it.each([false, true])("普通目录结构优先于同批游戏名称，倒序：%s", (reverse) => {
    const entries = [
      { source_path: "a", rel_path: "game.zip", file_type: "RPGMAKER_MV_MZ" },
      { source_path: "b", rel_path: "game/readme.txt" },
      { source_path: "c", rel_path: "game/sub/note.txt" },
    ];
    const paths = new Map(
      create_service()
        .assign_source_file_paths(reverse ? entries.reverse() : entries)
        .map((entry) => [entry.source_path, entry.rel_path.replaceAll("\\", "/")]),
    );
    expect(paths).toEqual(
      new Map([
        ["a", "game_20261011_123456.zip"],
        ["b", "game/readme.txt"],
        ["c", "game/sub/note.txt"],
      ]),
    );
  });

  it("已有游戏保持原名，新普通目录共享一次时间戳前缀且不会并入其他目录", () => {
    const paths = create_service()
      .assign_source_file_paths(
        [
          { source_path: "a", rel_path: "game/readme.txt" },
          { source_path: "b", rel_path: "game/sub/note.txt" },
          { source_path: "c", rel_path: "game.zip", file_type: "RPGMAKER_MV_MZ" },
        ],
        [
          { path: "game.zip", file_type: "RPGMAKER_MV_MZ" },
          { path: "game_20261011_123456/other.txt", file_type: "TXT" },
        ],
      )
      .map((entry) => entry.rel_path.replaceAll("\\", "/"));
    expect(paths).toEqual([
      "game_20261011_123456_2/readme.txt",
      "game_20261011_123456_2/sub/note.txt",
      "game.zip",
    ]);
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 11, 12, 34, 56));
  });
  afterEach(() => vi.useRealTimers());
  it.each(["XLSX", "WOLFXLSX"] as const)("XLSX 分发保留 %s 的解析身份", async (file_type) => {
    const bytes = await spreadsheet_fixture(
      file_type === "WOLFXLSX"
        ? { A1: "code", B1: "flag", C1: "type", D1: "info", F2: "正文" }
        : { A1: "正文", B1: "译文" },
    );
    const result = await create_service().parse_asset("book.xlsx", bytes);
    expect(result).toMatchObject({
      kind: "items",
      items: [expect.objectContaining({ src: "正文", file_type })],
    });
  });

  it("按扩展名分发解析器，并保持 JSON 的 KV 优先与 MESSAGE fallback", async () => {
    const service = create_service();

    const txt_items = await service.parse_asset("demo.txt", new TextEncoder().encode("甲"));
    const kv_items = await service.parse_asset(
      "kv.json",
      new TextEncoder().encode(JSON.stringify({ 甲: "译文" })),
    );
    const message_items = await service.parse_asset(
      "message.json",
      new TextEncoder().encode(JSON.stringify([{ name: "名", message: "台词" }])),
    );

    if (txt_items.kind !== "items" || kv_items.kind !== "items" || message_items.kind !== "items")
      throw new Error("Expected text items");
    expect(txt_items.items.map((item) => item.file_type)).toEqual(["TXT"]);
    expect(kv_items.items.map((item) => item.file_type)).toEqual(["KVJSON"]);
    expect(message_items.items.map((item) => item.file_type)).toEqual(["MESSAGEJSON"]);
  });

  it.each([
    ["a.md", "正文", "MD_V2"],
    [
      "a.ass",
      "[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,字幕",
      "ASS",
    ],
    ["a.srt", "1\n00:00:01,000 --> 00:00:02,000\n字幕\n", "SRT"],
    ["a.ssa", "[Events]\nDialogue: Marked=0,0:00:01.00,0:00:02.00,Default,,0,0,0,,字幕", "ASS"],
    ["a.vtt", "WEBVTT\n\n00:00.000 --> 00:01.000\n字幕", "VTT"],
    ["a.lrc", "[00:01.00]字幕", "LRC"],
  ] as const)("按简单扩展名解析 %s", async (rel_path, content, expected_type) => {
    const service = create_service();

    const items = await service.parse_asset(rel_path, new TextEncoder().encode(content));

    if (items.kind !== "items") throw new Error("Expected text items");
    expect(items.items.at(-1)?.file_type).toBe(expected_type);
  });

  it("未知扩展名解析为空列表", async () => {
    const service = create_service();

    await expect(service.parse_asset("a.bin", new TextEncoder().encode("bytes"))).resolves.toEqual({
      items: [],
      kind: "items",
      file_type: "NONE",
    });
  });

  it("源文件摘要按去重后的互斥扩展名统计", async () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-file-format-service-"),
    );
    const service = create_service();
    const source_a = path.join(temp_dir.path, "source-a");
    const source_b = path.join(temp_dir.path, "source-b");
    const first_txt = path.join(source_a, "b.TXT");
    const ignored = path.join(source_a, "ignore.bin");
    fs.mkdirSync(path.join(source_a, "nested"), { recursive: true });
    fs.mkdirSync(source_b, { recursive: true });
    fs.writeFileSync(first_txt, "text", "utf-8");
    fs.writeFileSync(path.join(source_a, "nested", "a.md"), "markdown", "utf-8");
    fs.writeFileSync(ignored, "ignored", "utf-8");
    fs.writeFileSync(path.join(source_b, "c.json"), "{}", "utf-8");
    const expected_format_hit_counts = Object.fromEntries(
      PROJECT_SOURCE_FORMATS.map((format) => [format.id, 0]),
    );
    Object.assign(expected_format_hit_counts, { txt: 1, md: 1, json: 1 });

    expect(
      await service.summarize_source_files(["", source_a, first_txt, ignored, source_b, source_a]),
    ).toEqual({
      contains_game: false,
      source_file_count: 3,
      format_hit_counts: expected_format_hit_counts,
    });
  });

  it("收集单文件路径时使用文件名作为工程相对路径", async () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-file-format-service-"),
    );
    const service = create_service();
    const source_file = path.join(temp_dir.path, "nested", "a.MD");
    fs.mkdirSync(path.dirname(source_file), { recursive: true });
    fs.writeFileSync(source_file, "dummy", "utf-8");

    expect(await service.collect_source_file_entries([source_file])).toEqual([
      { source_path: source_file, rel_path: "a.MD", source: { kind: "file", format: "md" } },
    ]);
  });

  it("RenPy 导出通过 FileFormatService 写入当前条目译名", async () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-file-format-service-"),
    );
    const service = create_service();
    const text = ["translate schinese start:", "", '    # "Alice" "Hello"', '    "艾丽丝" ""'].join(
      "\n",
    );
    const parsed = await service.parse_asset("script.rpy", new TextEncoder().encode(text));
    if (parsed.kind !== "items") throw new Error("Expected RenPy items");
    const [item] = parsed.items;
    if (item === undefined) {
      throw new Error("测试样本应生成 RenPy 条目。");
    }
    item.dst = "你好";
    item.name_dst = "爱丽丝";

    await service.write_items([item], {
      paths: {
        translated_path: temp_dir.path,
        bilingual_path: path.join(temp_dir.path, "bilingual"),
      },
      asset_reader: () => Buffer.from(text),
      source_files: [{ path: "script.rpy", file_type: "RENPY_RPY" }],
    });

    const output = await service.parse_asset(
      "script.rpy",
      fs.readFileSync(path.join(temp_dir.path, "script.rpy")),
    );
    if (output.kind !== "items") throw new Error("Expected RenPy items");
    expect(output.items).toMatchObject([{ dst: "你好", name_dst: "爱丽丝" }]);
  });
});

it("识别失败与正常来源共同进入只读摘要，正式导入重新识别", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-discover-"));
  const source = path.join(temp.path, "bad.exe"),
    text = path.join(temp.path, "ok.txt");
  fs.writeFileSync(source, evb_fixture(new Map()).subarray(0, -1));
  fs.writeFileSync(text, "text");
  const service = new FileFormatService(
    new GameDirectoryOperations(),
    { target_language: "ZH" },
    async () => null,
  );
  const summary = await service.summarize_source_files([temp.path]);
  expect(summary.source_file_count).toBe(1);
  expect(fs.readdirSync(temp.path).sort()).toEqual(["bad.exe", "ok.txt"]);
  fs.writeFileSync(
    source,
    evb_fixture(
      new Map([
        ["data/System.json", Buffer.from("{}")],
        ["js/rmmz_core.js", Buffer.from("// engine")],
      ]),
    ),
  );
  const resolved = await service.discover_import_sources([
    { source_path: source, rel_path: "game.zip" },
  ]);
  expect(resolved[0]!.source).toMatchObject({
    kind: "game",
    file_type: "RPGMAKER_MV_MZ",
    game: {
      root: temp.path,
      data_root: temp.path,
      executable: source,
      engine: "mz",
    },
  });
});
it("正式导入先拒绝根目录恢复材料，来源摘要只读", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-recovery-"));
  const native = new NativeFs();
  native.write_file_sync(path.join(temp.path, "data/System.json"), "{}");
  native.write_file_sync(path.join(temp.path, "js/rmmz_core.js"), "");
  const workspace = path.join(temp.path, ".tmp");
  native.write_file_sync(path.join(workspace, "rollback/keep"), "recovery");
  native.write_file_sync(path.join(temp.path, "backup_lg/keep"), "old backup");
  const service = new FileFormatService(
    new GameDirectoryOperations(),
    { target_language: "ZH" },
    async () => null,
    native,
  );
  expect((await service.summarize_source_files([temp.path])).source_file_count).toBe(1);
  const entry = (await service.collect_source_file_entries([temp.path]))[0]!;
  await expect(service.prepare_source(entry)).rejects.toThrow(
    "Unknown game recovery layout: " + path.join(workspace, "rollback"),
  );
  expect(fs.readFileSync(path.join(workspace, "rollback/keep"), "utf8")).toBe("recovery");
  expect(fs.readdirSync(path.join(temp.path, "backup_lg"))).toEqual(["keep"]);
});

it("正式导入容器使用当前数据，不在游戏目录生成备份", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-import-current-"));
  const native = new NativeFs();
  const service = new FileFormatService(
    new GameDirectoryOperations(),
    { target_language: "ZH" },
    async () => null,
    native,
  );
  const files = new Map<string, string | Buffer>([
    [
      "www/data/System.json",
      JSON.stringify({ hasEncryptedImages: true, encryptionKey: MEDIA_KEY }),
    ],
    ["www/data/Broken.json", "{"],
    ["www/js/rpg_core.js", "// fixture"],
    ["www/js/plugins.js", "[]"],
    ["www/js/plugins/Menu.js", "// plugin"],
    ["www/fonts/Main.ttf", "old font"],
    ["www/fonts/css/game.css", "font config"],
    ["www/img/a.png_", encrypted_media(png_fixture())],
  ]);
  for (const [name, text] of files) native.write_file_sync(path.join(temp.path, name), text);
  const entry = (await service.collect_source_file_entries([temp.path]))[0]!;
  const asset = await service.prepare_source(entry);
  const { members, game_files } = await read_game_container(asset.content, "game.zip");
  const names = (await game_files!.async("string")).split("\n");
  expect(names).toContain("www/img/a.png");
  expect(names).not.toContain("www/img/a.png_");
  expect(await members.get("www/data/System.json")!.async("string")).toContain(
    '"hasEncryptedImages":false',
  );
  expect([...members.keys()].some((name) => name.includes("fonts/"))).toBe(false);
  native.write_file_sync(path.join(temp.path, "www/data/System.json"), '{"gameTitle":"changed"}');
  const changed = await service.prepare_source(entry);
  expect(fs.existsSync(path.join(temp.path, "backup_lg"))).toBe(false);
  const current = await read_game_container(changed.content, "game.zip");
  expect(await current.members.get("www/data/System.json")!.async("string")).toBe(
    '{"gameTitle":"changed"}',
  );
});

it.each(["read", "existing-read"])("导入 %s 失败保留准备结果并允许重试", async (phase) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-read-"));
  const native = new NativeFs();
  const files = new Map([
    [
      "data/System.json",
      Buffer.from(JSON.stringify({ hasEncryptedImages: true, encryptionKey: MEDIA_KEY })),
    ],
    ["js/rmmz_core.js", Buffer.from("// fixture")],
    ["data/Actors.json", Buffer.from("[]")],
    ["img/a.png_", encrypted_media(png_fixture())],
  ]);
  for (const [name, bytes] of files) native.write_file_sync(path.join(temp.path, name), bytes);
  const service = new FileFormatService(
    new GameDirectoryOperations(),
    { target_language: "ZH" },
    async () => null,
    native,
  );
  const entry = (await service.collect_source_file_entries([temp.path]))[0]!;
  if (phase === "existing-read") await service.prepare_source(entry);
  const read = native.read_file.bind(native);
  vi.spyOn(native, "read_file").mockImplementation((file) => {
    if (file === path.join(temp.path, "data/Actors.json")) throw new Error("read failure");
    return read(file);
  });
  await expect(service.prepare_source(entry)).resolves.toMatchObject({
    directory_changed: phase === "read",
    diagnostics: expect.arrayContaining([expect.objectContaining({ stage: "read" })]),
  });
  expect(fs.readFileSync(path.join(temp.path, "img/a.png")).equals(png_fixture())).toBe(true);
  expect(fs.existsSync(path.join(temp.path, "img/a.png_"))).toBe(false);
  vi.restoreAllMocks();
  await service.prepare_source((await service.collect_source_file_entries([temp.path]))[0]!);
  expect(fs.readFileSync(path.join(temp.path, "data/System.json"), "utf8")).toContain(
    '"hasEncryptedImages":false',
  );
});

it("产品门面完成来源摘要、准备、容器、翻译与导出", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-product-"));
  const root = path.join(temp.path, "game"),
    native = new NativeFs(),
    files = create_godot_fixture();
  native.write_file_sync(path.join(root, "game.pck"), godot_pack_fixture(files));
  const service = new FileFormatService(
    new GameDirectoryOperations(),
    { target_language: "ZH" },
    create_pdf_execution(),
    native,
  );
  const carrier = path.join(root, "game.pck");
  const [unsupported] = await service.discover_import_sources([
    { source_path: carrier, rel_path: "game.pck" },
  ]);
  expect(unsupported!.source).toEqual({ kind: "file", format: undefined });
  expect(await service.summarize_source_files([root])).toMatchObject({
    source_file_count: 1,
    format_hit_counts: { godot: 1 },
  });
  const entry = (await service.collect_source_file_entries([root]))[0]!;
  const container = await service.prepare_source(entry);
  const parsed = await service.parse_asset(entry.rel_path, container.content, entry.file_type);
  if (parsed.kind !== "items") throw new Error("Expected game items");
  expect(parsed.warnings).toEqual([]);
  expect(
    parsed.items.some((item) => FileFormatService.default_status(item) === "RULE_SKIPPED"),
  ).toBe(true);
  const item = parsed.items.find(
    (item) => read_godot_metadata(item.extra_field).internal_file_path === "messages.translation",
  )!;
  const out = path.join(temp.path, "translated");
  await service.write_items([{ ...item, status: "PROCESSED", dst: "产品译文" }], {
    paths: { translated_path: out, bilingual_path: path.join(temp.path, "bilingual") },
    source_files: [{ path: entry.rel_path, file_type: "GODOT" }],
    asset_reader: () => Buffer.from(container.content),
  });
  const output = path.join(out, "game/messages.translation");
  expect(
    read_translation(read_resource(fs.readFileSync(output))).slots.some(
      (slot) => slot.text === "产品译文",
    ),
  ).toBe(true);
});
