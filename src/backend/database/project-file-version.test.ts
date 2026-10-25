import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { read_project_file_version, update_project_file_version } from "./project-file-version";

it.each([
  [null, '"1.0.0"'],
  ["broken-json", '"1.0.0"'],
  ["123", '"1.0.0"'],
  ['"0.9.0"', '"1.0.0"'],
  ['"01.00.00"', '"01.00.00"'],
  ['"02.00.00"', '"02.00.00"'],
])("补齐未知版本或升级低版本，保留同版及高版原值：%s", (raw, expected) => {
  using db = new DatabaseSync(":memory:");
  expect(read_project_file_version(db)).toBeNull();
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  if (raw !== null) db.prepare("INSERT INTO meta VALUES ('target_app_version', ?)").run(raw);
  update_project_file_version(db, "1.0.0");
  expect(db.prepare("SELECT value FROM meta WHERE key = 'target_app_version'").get()?.value).toBe(
    expected,
  );
});
