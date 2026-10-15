import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { run_asset_file_type_migration } from "./asset-file-type-migration";

it("迁移优先保留 PDF 和首个有效条目身份，未知空资产等待内容识别", () => {
  using db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE assets (path TEXT PRIMARY KEY, file_type TEXT DEFAULT 'NONE');
    CREATE TABLE items (id INTEGER PRIMARY KEY, data TEXT);
    CREATE TABLE pdf_documents (file_path TEXT);
    INSERT INTO assets (path) VALUES ('game.json'), ('book.pdf'), ('empty.txt'), ('empty.json');
    INSERT INTO pdf_documents VALUES ('book.pdf');
  `);
  const rows = [
    { file_path: "game.json", file_type: "NONE" },
    {
      file_path: "game.json",
      file_type: "MESSAGEJSON",
      text_type: "RPGMAKER",
      extra_field: { keep: true },
    },
    { file_path: "game.json", file_type: "KVJSON" },
    { file_path: "book.pdf", file_type: "TXT" },
  ];
  const insert = db.prepare("INSERT INTO items(data) VALUES (?)");
  for (const row of rows) insert.run(JSON.stringify(row));
  insert.run("broken-json");
  run_asset_file_type_migration(db);
  expect(db.prepare("SELECT path, file_type FROM assets ORDER BY path").all()).toEqual([
    { path: "book.pdf", file_type: "PDF" },
    { path: "empty.json", file_type: "NONE" },
    { path: "empty.txt", file_type: "TXT" },
    { path: "game.json", file_type: "MESSAGEJSON" },
  ]);
  const migrated = db.prepare("SELECT data FROM items ORDER BY id").all();
  expect(migrated.slice(0, -1).map((row) => JSON.parse(String(row["data"])))).toEqual([
    { file_path: "game.json" },
    { file_path: "game.json", extra_field: { keep: true } },
    { file_path: "game.json" },
    { file_path: "book.pdf" },
  ]);
  expect(migrated.at(-1)?.["data"]).toBe("broken-json");
});
