import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { expect, it } from "vitest";
import { create_item } from "../../../domain/item";
import { ProjectDatabase } from "../../database/database-operations";
import { GenericFormat } from "../../file/generic/generic-format";
import type { ProjectOpenMigrationInput } from "../migration-types";
import { build_project_open_writes } from "../project-migrations";

/** 使用工程打开期的同一批写入操作，观察数据库和包内容。 */
async function commit_open_writes(input: ProjectOpenMigrationInput): Promise<void> {
  const writes = await build_project_open_writes(input);
  await input.database.transaction(input.project_path, (writer) => {
    for (const write of writes) write(writer);
  });
}

it("迁移保留条目和原稿，避让其他迁移包及游戏输出目录", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-legacy-xlsx-trans-"));
  const project_path = path.join(temp.path, "old.lg");
  const database = new ProjectDatabase("1.0.0");
  const input = { database, project_path };
  const source = Buffer.from([0, 255, 170, 1]); // 故意无法解析，迁移只依赖工程内已有条目。
  const trans_ref = { file_key: "data/Actors.json", row_index: 1 };
  try {
    await database.create_project(project_path, (writer) => {
      writer.add_asset(project_path, "book.xlsx", source, "PDF", 4);
      writer.add_asset(project_path, "Book.XLSX", source, "XLSX", 4);
      writer.add_asset(project_path, "BOOK.XLSX.generic.wolfrpg", source, "WOLFRPG", 4);
      writer.add_asset(project_path, "wolf.xlsx", source, "WOLFXLSX", 6);
      writer.add_asset(project_path, "game.trans", source, "TRANS", 7);
      writer.set_items(project_path, [
        { id: 1, file_path: "Book.XLSX", row: 5, src: "后", dst: "Later", status: "NONE" },
        { id: 2, file_path: "Book.XLSX", row: 2, src: "先", dst: "First", status: "PROCESSED" },
        { id: 8, file_path: "Book.XLSX", row: 2, src: "同一行", dst: "", status: "PROCESSED" },
        { id: 5, file_path: "wolf.xlsx", row: 3, src: "对白", status: "RULE_SKIPPED" },
        {
          id: 3,
          file_path: "game.trans",
          row: 7,
          src: "原文",
          dst: "译文",
          name_src: "原名",
          name_dst: "译名",
          status: "PROCESSED",
          extra_field: { trans_ref },
          tag: "data/Actors.json",
        },
        { id: 4, file_path: "game.trans", row: 8, src: "缺定位", tag: "data/Actors.json" },
      ]);
    });
    const before = await database.get_all_items(project_path);
    await commit_open_writes(input);

    const book = "Book.XLSX_3.generic";
    const wolf = "wolf.xlsx.generic";
    const game = "game.trans.generic";
    expect(await database.get_all_asset_records(project_path)).toEqual([
      { path: "book.xlsx_2.generic", file_type: "GENERIC", sort_order: 4 },
      { path: book, file_type: "GENERIC", sort_order: 4 },
      { path: "BOOK.XLSX.generic.wolfrpg", file_type: "WOLFRPG", sort_order: 4 },
      { path: wolf, file_type: "GENERIC", sort_order: 6 },
      { path: game, file_type: "GENERIC", sort_order: 7 },
    ]);
    const migrated = await database.get_all_items(project_path);
    const positions = [
      [book, 2],
      [book, 0],
      [game, 0],
      [game, 1],
      [wolf, 0],
      [book, 1],
    ] as const;
    expect(migrated).toEqual(
      before.map((item, index) => ({
        ...create_item(item),
        file_path: positions[index]![0],
        row: positions[index]![1],
        file_type: "GENERIC",
        extra_field: "",
        tag: "",
      })),
    );

    const format = new GenericFormat();
    for (const [file, member, readme_markers, messages] of [
      [
        book,
        "source.xlsx",
        ["`xlsx`", "`source.xlsx`", "`sheet_row`", "A 列为原文、B 列为译文"],
        [
          { message: "先", legacy_file_type: "XLSX", sheet_row: 2 },
          { message: "同一行", legacy_file_type: "XLSX", sheet_row: 2 },
          { message: "后", legacy_file_type: "XLSX", sheet_row: 5 },
        ],
      ],
      [
        wolf,
        "source.xlsx",
        ["`xlsx`", "`source.xlsx`", "F 列为原文、G 列为译文", "索引色 `9`"],
        [{ message: "对白", legacy_file_type: "WOLFXLSX", sheet_row: 3 }],
      ],
      [
        game,
        "source.trans",
        ["`generic-package`", "`source.trans`", "`trans_ref`", "`project.indexTranslation`"],
        [
          {
            message: "原文",
            name: "原名",
            legacy_file_type: "TRANS",
            trans_ref,
            tag: "data/Actors.json",
            legacy_row: 7,
          },
          {
            message: "缺定位",
            legacy_file_type: "TRANS",
            trans_ref: null,
            tag: "data/Actors.json",
            legacy_row: 8,
          },
        ],
      ],
    ] as const) {
      const bytes = (await database.read_asset_content(project_path, file))!;
      const zip = await JSZip.loadAsync(bytes);
      expect(await zip.file(member)!.async("nodebuffer")).toEqual(source);
      expect(JSON.parse(await zip.file("items.json")!.async("string"))).toEqual(messages);
      const readme = await zip.file("README.md")!.async("string");
      for (const marker of readme_markers) expect(readme).toContain(marker);
    }
    const book_bytes = (await database.read_asset_content(project_path, book))!;
    expect(
      JSON.parse(
        await format.render_text(
          book_bytes,
          migrated.filter((item) => item["file_path"] === book).map(create_item),
          book,
        ),
      ),
    ).toEqual([
      { message: "First", legacy_file_type: "XLSX", sheet_row: 2 },
      { message: "", legacy_file_type: "XLSX", sheet_row: 2 },
      { message: "后", legacy_file_type: "XLSX", sheet_row: 5 },
    ]);
    await database.close_project(project_path);
    expect(await build_project_open_writes(input)).toEqual([]);
    expect(await database.get_all_items(project_path)).toEqual(migrated);
  } finally {
    await database.close();
  }
});

it("无条目的历史 NONE 资产按后缀封存为空通用包", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-legacy-empty-"));
  const project_path = path.join(temp.path, "old.lg");
  const database = new ProjectDatabase("1.0.0");
  const input = { database, project_path };
  const source = Buffer.from("old source");
  try {
    await database.create_project(project_path, (writer) => {
      writer.add_asset(project_path, "empty.xlsx", source, "NONE", 0);
      writer.add_asset(project_path, "empty.TRANS", source, "NONE", 1);
    });
    await commit_open_writes(input);
    for (const [file, member, marker] of [
      ["empty.xlsx.generic", "source.xlsx", "按底稿调查工作表与列布局"],
      ["empty.TRANS.generic", "source.trans", "`source.trans`"],
    ] as const) {
      const bytes = (await database.read_asset_content(project_path, file))!;
      const zip = await JSZip.loadAsync(bytes);
      expect(await zip.file(member)!.async("nodebuffer")).toEqual(source);
      expect(await zip.file("items.json")!.async("string")).toBe("[]");
      expect(await zip.file("README.md")!.async("string")).toContain(marker);
    }
    expect(await database.get_all_items(project_path)).toEqual([]);
  } finally {
    await database.close();
  }
});
