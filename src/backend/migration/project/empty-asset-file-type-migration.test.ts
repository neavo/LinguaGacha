import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { expect, it } from "vitest";
import { ProjectDatabase } from "../../database/database-operations";
import { empty_asset_file_type_migration } from "./empty-asset-file-type-migration";

it("零条目旧 JSON 和 WOLF 工作簿从原稿识别一次，身份与完成标记一起回滚", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-asset-migration-"));
  const project = path.join(temp.path, "old.lg");
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Sheet1").addRow(["code", "flag", "type", "info"]);
  const xlsx = new Uint8Array(await workbook.xlsx.writeBuffer());
  const database = new ProjectDatabase("1.0.0");
  try {
    await database.create_project(project, "old", (database) => {
      database.add_asset(project, "object.json", Buffer.from("{}"), "NONE", null);
      database.add_asset(project, "array.json", Buffer.from("[]"), "NONE", null);
      database.add_asset(project, "broken.json", Buffer.from("{"), "NONE", null);
      database.add_asset(project, "wolf.xlsx", xlsx, "NONE", null);
    });
    const context = {
      project_path: project,
      database,
      assets: await database.get_all_asset_records(project),
      meta: {},
    };
    const writes = await empty_asset_file_type_migration(context);
    await expect(
      database.transaction(project, (database) => {
        for (const write of writes) write(database);
        throw new Error("rollback");
      }),
    ).rejects.toThrow();
    expect(
      (await database.get_all_asset_records(project)).every((file) => file.file_type === "NONE"),
    ).toBe(true);
    await database.transaction(project, (database) => {
      for (const write of writes) write(database);
    });
    expect((await database.get_all_asset_records(project)).map((file) => file.file_type)).toEqual([
      "KVJSON",
      "MESSAGEJSON",
      "NONE",
      "WOLFXLSX",
    ]);
    expect(
      (await database.read_asset_content(project, "wolf.xlsx"))!.equals(Buffer.from(xlsx)),
    ).toBe(true);
    expect(
      await empty_asset_file_type_migration({
        ...context,
        meta: await database.get_all_meta(project),
      }),
    ).toEqual([]);
  } finally {
    await database.close();
  }
});
