import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { FileFormatService } from "../file-format-service";
import { SourceFileParsePipeline } from "../source-file-parse-pipeline";
import { ProjectDatabase } from "../../database/database-operations";
import { ProjectDataReader } from "../../project/project-data-reader";

it.each(["", "www"])(
  "游戏 %s 的发现、失败隔离、固化字节与零条目身份贯通重开和导出",
  async (prefix) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rm-source-"));
    const root = path.join(temp.path, "game");
    const files: Record<string, string> = {
      "data/System.json": '{"currencyUnit":"金"}',
      "data/Actors.json": '[null,{"name":"勇者","note":"备注"}]',
      "data/Empty.json": "[]",
      "js/rmmz_core.js": "",
      "js/plugins.js": "var $plugins = [];",
      "js/plugins/bad.js": 'const s = "',
      "js/plugins/good.js": 'const s = "插件";',
    };
    for (const [file, text] of Object.entries(files)) {
      const target = path.join(root, prefix, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
    }
    fs.writeFileSync(path.join(root, "Game.exe"), "");
    const service = new FileFormatService({ target_language: "ZH" }, async () => null);
    expect(service.collect_source_file_entries([path.join(root, "Game.exe")])).toEqual(
      service.collect_source_file_entries([root]),
    );
    expect(service.summarize_source_files([root]).format_hit_counts.rpgmaker_mv_mz).toBe(6);
    expect(
      service.summarize_source_files([path.join(root, prefix, "data/Actors.json")])
        .format_hit_counts.rpgmaker_mv_mz,
    ).toBe(1);
    const draft = await new SourceFileParsePipeline(service).build_project_draft([root]);
    expect(draft.failed_files).toMatchObject([{ silent: true, filename: "bad.js" }]);
    expect(draft.files).toHaveLength(5);
    fs.writeFileSync(path.join(root, prefix, "data/Actors.json"), "[]"); // 入库必须使用准备阶段的字节。
    const project = path.join(temp.path, "game.lg");
    const database = new ProjectDatabase();
    try {
      database.create_project(project, "game", () => {
        for (const file of draft.files)
          database.add_asset(
            project,
            file.rel_path,
            file.content,
            file.file_type,
            null,
            file.sort_index,
          );
        database.set_items(project, draft.items);
      });
      const reader = new ProjectDataReader(database);
      expect(
        Object.values(reader.build_files_record_block(project)).every(
          (file) => file.file_type === "RPGMAKER_MV_MZ",
        ),
      ).toBe(true);
      const items = reader.read_items(project);
      expect(items.some((item) => item.src === "勇者")).toBe(true);
      expect(items.every((item) => !("text_type" in item))).toBe(true);
      const output = path.join(temp.path, "out");
      await service.write_items(draft.items, {
        paths: { translated_path: output, bilingual_path: path.join(temp.path, "bilingual") },
        source_files: database.get_all_asset_records(project),
        asset_reader: (file) => database.read_asset_content(project, file),
      });
      expect(fs.readFileSync(path.join(output, prefix, "data/Empty.json"), "utf8")).toBe("[]");
      expect(fs.readFileSync(path.join(output, prefix, "data/Actors.json"), "utf8")).toBe(
        files["data/Actors.json"],
      );
      expect(fs.existsSync(path.join(temp.path, "bilingual"))).toBe(false);
    } finally {
      database.close();
    }
  },
);
