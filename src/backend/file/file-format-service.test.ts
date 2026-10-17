import { wolf_files } from "../../test/wolf-fixture";
import { evb_fixture } from "../../test/evb-fixture";
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

/**
 * 测试统一使用显式配置，避免依赖用户本机设置
 */
function create_service(): FileFormatService {
  return new FileFormatService(
    {
      target_language: "ZH",
      deduplication_in_bilingual: true,
      write_translated_name_fields_to_file: true,
    },
    create_pdf_execution(),
  );
}

describe("FileFormatService", () => {
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

  it("RenPy 导出通过 FileFormatService 注入姓名字段配置", async () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-file-format-service-"),
    );
    const service = new FileFormatService(
      {
        target_language: "ZH",
        deduplication_in_bilingual: true,
        write_translated_name_fields_to_file: false,
      },
      create_pdf_execution(),
    );
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
      source_files: [{ path: "script.rpy", file_type: "RENPY" }],
    });

    expect(fs.readFileSync(path.join(temp_dir.path, "script.rpy"), "utf-8")).toContain(
      '"Alice" "你好"',
    );
  });
});

it("识别失败与正常来源共同进入只读摘要，正式导入重新识别", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-discover-"));
  const source = path.join(temp.path, "bad.exe"),
    text = path.join(temp.path, "ok.txt");
  fs.writeFileSync(source, evb_fixture(new Map()).subarray(0, -1));
  fs.writeFileSync(text, "text");
  const service = new FileFormatService({ target_language: "ZH" }, async () => null);
  const summary = await service.summarize_source_files([temp.path]);
  expect(summary.source_file_count).toBe(1);
  expect(summary.failed_files).toMatchObject([{ source_path: source }]);
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
    kind: "mv_mz",
    game: {
      root: temp.path,
      data_root: temp.path,
      executable: source,
      engine: "mz",
    },
  });
});
it.each(["mv_mz", "rgss", "wolfrpg"])(
  "%s 正式导入先拒绝根目录恢复材料，来源摘要只读",
  async (kind) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-recovery-"));
    const native = new NativeFs();
    if (kind === "mv_mz") {
      native.write_file_sync(path.join(temp.path, "data/System.json"), "{}");
      native.write_file_sync(path.join(temp.path, "js/rmmz_core.js"), "");
    } else if (kind === "rgss") {
      native.write_file_sync(
        path.join(temp.path, "Game.ini"),
        "[Game]\nScripts=Data/Scripts.rvdata2",
      );
      native.write_file_sync(path.join(temp.path, "Data/System.rvdata2"), Buffer.from([4, 8, 48]));
    } else {
      for (const [name, bytes] of wolf_files())
        native.write_file_sync(path.join(temp.path, name), bytes);
    }
    const workspace = path.join(temp.path, ".tmp");
    native.write_file_sync(path.join(workspace, "rollback/keep"), "recovery");
    native.write_file_sync(path.join(temp.path, "backup_lg/keep"), "old backup");
    const service = new FileFormatService({ target_language: "ZH" }, async () => null, native);
    expect((await service.summarize_source_files([temp.path])).source_file_count).toBe(1);
    const entry = (await service.collect_source_file_entries([temp.path]))[0]!;
    await expect(service.prepare_source(entry)).rejects.toThrow(
      "Unfinished game operation; recovery files: " + workspace,
    );
    expect(fs.readFileSync(path.join(workspace, "rollback/keep"), "utf8")).toBe("recovery");
    expect(fs.readdirSync(path.join(temp.path, "backup_lg"))).toEqual(["keep"]);
  },
);
