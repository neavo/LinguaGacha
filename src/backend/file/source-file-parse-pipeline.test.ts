import { GameDirectoryOperations } from "./shared/game/game-directory-operations";
import { create_pdf_execution, create_pdf_fixture } from "./pdf/test-support";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FileFormatService } from "./file-format-service";
import { SourceFileParsePipeline } from "./source-file-parse-pipeline";
import { ProjectDatabase } from "../database/database-operations";
import { ProjectDataReader } from "../project/project-data-reader";
import { create_item } from "../../domain/item";

/** 固定解析配置，避免读取本机设置。 */
function create_format_service(): FileFormatService {
  return new FileFormatService(
    new GameDirectoryOperations(),
    {
      target_language: "ZH",
    },
    create_pdf_execution(),
  );
}

describe("SourceFileParsePipeline", () => {
  it("字幕工程重开后保持文件身份和正文位置，零条目文件参与导出", async () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-source-file-pipeline-"),
    );
    const samples = [
      ["empty.txt", ""],
      ["object.json", "{}"],
      ["array.json", "[]"],
      ["text.txt", "正文"],
      ["book.pdf", create_pdf_fixture()],
      ["empty.vtt", "WEBVTT\n\nNOTE structure\n"],
      ["empty.lrc", "[offset:50]\n[00:01]\n"],
      ["empty.ssa", "[Events]\n"],
      ["text.vtt", "WEBVTT\n\n00:00.000 --> 00:01.000\n<b>原文</b>尾文\n"],
    ] as const;
    const source_paths = samples.map(([name, content]) => {
      const source_path = path.join(temp_dir.path, name);
      fs.writeFileSync(source_path, content);
      return source_path;
    });
    const expected_types = [
      "TXT",
      "KVJSON",
      "MESSAGEJSON",
      "TXT",
      "PDF",
      "VTT",
      "LRC",
      "ASS",
      "VTT",
    ];
    const service = create_format_service();
    const pipeline = new SourceFileParsePipeline(service);
    const draft = await pipeline.build_project_draft(
      service.assign_source_file_paths(await service.collect_source_file_entries(source_paths)),
    );
    expect(draft.failed_files).toEqual([]);
    expect(draft.files.map((file) => file.file_type)).toEqual(expected_types);
    expect(draft.items.every((item) => item["src"] !== "")).toBe(true);

    const database = new ProjectDatabase();
    const project_path = path.join(temp_dir.path, "project.lg");
    try {
      await database.create_project(project_path, "文件类型", (database) => {
        for (const file of draft.files) {
          database.add_asset(
            project_path,
            file.rel_path,
            file.content,
            file.file_type,
            file.pdf_document,
            file.sort_index,
          );
        }
        database.set_items(project_path, draft.items);
      });
      const files = await database.read(project_path, (access) =>
        new ProjectDataReader(access).build_files_record_block(project_path),
      );
      // create_project 已结束 scoped 连接，此次读取会重新打开真实 .lg。
      expect(Object.values(files).map((file) => (file as { file_type: string }).file_type)).toEqual(
        expected_types,
      );
      const saved = await database.get_all_items(project_path);
      const items = (Array.isArray(saved) ? saved : []).map((item) => create_item(item));
      const target = items.find((item) => item.src === "原文")!;
      target.status = "PROCESSED";
      target.dst = "译文";
      const output = path.join(temp_dir.path, "out");
      await create_format_service().write_items(items, {
        paths: { translated_path: output, bilingual_path: path.join(output, "bilingual") },
        source_files: draft.files.map((file) => ({
          path: file.rel_path,
          file_type: file.file_type,
        })),
        asset_reader: async (file) => await database.read_asset_content(project_path, file),
      });
      expect(fs.readFileSync(path.join(output, "text.vtt"), "utf8")).toBe(
        "WEBVTT\n\n00:00.000 --> 00:01.000\n<b>译文</b>尾文\n",
      );
      expect(fs.readFileSync(path.join(output, "empty.lrc"), "utf8")).toBe(
        "[offset:50]\n[00:01]\n",
      );
    } finally {
      await database.close();
    }
  });

  it("新建工程草稿跳过不支持格式，并保留支持格式解析失败明细", async () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-source-file-pipeline-"),
    );
    const source_file = path.join(temp_dir.path, "script.txt");
    const broken_json = path.join(temp_dir.path, "broken.json");
    const ignored_file = path.join(temp_dir.path, "noise.bin");
    fs.writeFileSync(source_file, "原文", "utf-8");
    fs.writeFileSync(broken_json, "{", "utf-8");
    fs.writeFileSync(ignored_file, "noise", "utf-8");
    const service = create_format_service();
    const pipeline = new SourceFileParsePipeline(service);

    const draft = await pipeline.build_project_draft(
      service.assign_source_file_paths(
        await service.collect_source_file_entries([source_file, broken_json, ignored_file]),
      ),
    );

    expect(draft.files.map(({ content: _content, ...file }) => file)).toEqual([
      {
        rel_path: "script.txt",
        pdf_document: null,
        file_type: "TXT",
        sort_index: 0,
      },
    ]);
    expect(draft.items).toEqual([
      expect.objectContaining({
        id: 1,
        src: "原文",
        file_path: "script.txt",
        file_type: "TXT",
      }),
    ]);
    expect(draft.failed_files).toEqual([
      {
        source_path: broken_json,
        rel_path: "broken.json",
        filename: "broken.json",
        code: "file.parse_failed",
        message: expect.any(String),
      },
    ]);
  });

  it("项目文件导入命令只按调用方目标路径解析，不重新推导相对路径", async () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-source-file-pipeline-"),
    );
    const source_file = path.join(temp_dir.path, "script.txt");
    fs.writeFileSync(source_file, "原文", "utf-8");
    const service = create_format_service();
    const pipeline = new SourceFileParsePipeline(service);

    const result = await pipeline.parse_import_commands([
      {
        source_path: source_file,
        rel_path: "nested/target.txt",
        file_type: "TXT",
        source: { kind: "file", format: "txt" },
      },
    ]);

    expect(result.failed_files).toEqual([]);
    expect(result.file_drafts).toEqual([
      expect.objectContaining({
        source_path: source_file,
        rel_path: "nested/target.txt",
        file_type: "TXT",
        parsed_items: [
          expect.objectContaining({
            src: "原文",
            file_path: "nested/target.txt",
            file_type: "TXT",
          }),
        ],
      }),
    ]);
  });
});

it("多个带后缀同名游戏混合导入，入口去重并按原目录名导出", async () => {
  const name = "game.zip";
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rm-mixed-"));
  const roots = [path.join(temp.path, "a", name), path.join(temp.path, "b", name)];
  for (const [index, root] of roots.entries()) {
    const prefix = index === 0 ? "" : "www";
    fs.mkdirSync(path.join(root, prefix, "data"), { recursive: true });
    fs.mkdirSync(path.join(root, prefix, "js"), { recursive: true });
    fs.writeFileSync(
      path.join(root, prefix, "data/System.json"),
      JSON.stringify({ currencyUnit: "游戏" + index }),
    );
    fs.writeFileSync(path.join(root, prefix, "js/rmmz_core.js"), "");
    fs.writeFileSync(path.join(root, "Game.exe"), "");
  }
  fs.writeFileSync(path.join(temp.path, "readme.txt"), "说明");
  const service = new FileFormatService(
    new GameDirectoryOperations(),
    { target_language: "ZH" },
    async () => null,
  );
  const inputs = [
    path.join(roots[0]!, "data/System.json"),
    temp.path,
    ...roots,
    path.join(roots[0]!, "Game.exe"),
  ];
  const draft = await new SourceFileParsePipeline(service).build_project_draft(
    service.assign_source_file_paths(await service.collect_source_file_entries(inputs)),
  );
  expect(draft.failed_files).toEqual([]);
  const second_game = draft.files[1]!.rel_path;
  expect(second_game.slice(name.length)).toMatch(/^_\d{8}_\d{6}\.rpgmaker$/u);
  expect(draft.files.map((file) => [file.rel_path, file.file_type])).toEqual([
    [`${name}.rpgmaker`, "RPGMAKER_MV_MZ"],
    [second_game, "RPGMAKER_MV_MZ"],
    [path.join(path.basename(temp.path), "readme.txt"), "TXT"],
  ]);
  expect(
    draft.items
      .filter((item) => item.file_type === "RPGMAKER_MV_MZ")
      .map((item) => [item.file_path, item.row]),
  ).toEqual([
    [`${name}.rpgmaker`, 0],
    [second_game, 0],
  ]);
  for (const item of draft.items)
    Object.assign(item, { status: "PROCESSED", dst: item.src + "译" });
  const output = path.join(temp.path, "out");
  await service.write_items(draft.items, {
    paths: { translated_path: output, bilingual_path: path.join(temp.path, "bilingual") },
    source_files: draft.files.map((file) => ({ path: file.rel_path, file_type: file.file_type })),
    asset_reader: (file) =>
      Buffer.from(draft.files.find((entry) => entry.rel_path === file)!.content),
  });
  expect(JSON.parse(fs.readFileSync(path.join(output, name, "data/System.json"), "utf8"))).toEqual({
    currencyUnit: "游戏0译",
  });
  expect(
    JSON.parse(
      fs.readFileSync(
        path.join(output, path.basename(second_game, ".rpgmaker"), "www/data/System.json"),
        "utf8",
      ),
    ),
  ).toEqual({ currencyUnit: "游戏1译" });
});
