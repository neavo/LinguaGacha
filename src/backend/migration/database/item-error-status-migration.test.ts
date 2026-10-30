import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { run_item_error_status_migration } from "./item-error-status-migration";
import {
  run_project_database_migrations,
  PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
} from "../database-migrations";

it.each([false, true])("升级保留原条目和累计用量，协调重复代表且幂等：%s", (enabled) => {
  using db = new DatabaseSync(":memory:");
  run_project_database_migrations(db, "1.0.0", []);
  const originals = [
    { status: "ERROR", src: "A" },
    { status: "DUPLICATED", src: "A" },
    { status: "PROCESSED", src: "B" },
    { status: "ERROR", src: "B" },
    { status: "EXCLUDED", src: "C" },
  ].map((item, index) => ({
    ...item,
    id: index + 1,
    dst: "旧译文",
    name_src: "原名",
    name_dst: "旧译名",
    extra_field: { private: [index] },
    unknown: { keep: true },
    file_path: "a.txt",
  }));
  const insert = db.prepare("INSERT INTO items VALUES (?, ?)");
  originals.forEach((item) => insert.run(item.id, JSON.stringify(item)));
  insert.run(6, "broken-json");
  const usage = {
    start_time: 7,
    time: 12,
    total_input_tokens: 3,
    total_reasoning_tokens: 2,
    total_output_tokens: 1,
    total_tokens: 6,
  };
  const meta = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
  meta.run("skip_duplicate_source_text_enable", JSON.stringify(enabled));
  meta.run(
    "translation_extras",
    JSON.stringify({
      ...usage,
      total_line: 99,
      processed_line: 99,
      error_line: 2,
      line: 101,
      failed_line: 9,
    }),
  );

  run_item_error_status_migration(db);

  const statuses = enabled
    ? ["NONE", "DUPLICATED", "PROCESSED", "DUPLICATED", "EXCLUDED"]
    : ["NONE", "NONE", "PROCESSED", "NONE", "EXCLUDED"];
  const rows = db.prepare("SELECT * FROM items ORDER BY id").all();
  expect(rows.slice(0, 5).map((row) => JSON.parse(String(row.data)))).toEqual(
    originals.map((item, index) => ({ ...item, status: statuses[index] })),
  );
  expect(rows[5]!.data).toBe("broken-json");
  expect(
    JSON.parse(
      String(db.prepare("SELECT value FROM meta WHERE key = 'translation_extras'").get()!.value),
    ),
  ).toEqual({
    ...usage,
    total_line: enabled ? 2 : 4,
    processed_line: 1,
  });
  const before = db.prepare("SELECT * FROM meta ORDER BY key").all();
  run_item_error_status_migration(db);
  expect(db.prepare("SELECT * FROM items ORDER BY id").all()).toEqual(rows);
  expect(db.prepare("SELECT * FROM meta ORDER BY key").all()).toEqual(before);
});

it("已完成早期迁移的工程独立升级，计数写入失败回滚条目和标记后可重试", () => {
  using db = new DatabaseSync(":memory:");
  run_project_database_migrations(db, "1.0.0");
  const key = PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY;
  const read_marker = () =>
    JSON.parse(
      String(db.prepare("SELECT value FROM meta WHERE key = ?").get(key)!.value),
    ) as string[];
  const applied = read_marker();
  db.prepare("UPDATE meta SET value = ? WHERE key = ?").run(
    JSON.stringify(applied.filter((id) => id !== "item-error-status")),
    key,
  );
  db.prepare("INSERT INTO items VALUES (1, ?)").run(
    JSON.stringify({ src: "旧原文", dst: "保留译文", name_dst: "保留译名", status: "ERROR" }),
  );
  db.exec(
    "CREATE TRIGGER reject_progress BEFORE INSERT ON meta WHEN NEW.key = 'translation_extras' BEGIN SELECT RAISE(ABORT, 'progress failed'); END",
  );
  const before = db.prepare("SELECT * FROM items").all();
  const marker = read_marker();

  expect(() => run_project_database_migrations(db, "1.0.0")).toThrow("progress failed");
  expect(db.prepare("SELECT * FROM items").all()).toEqual(before);
  expect(read_marker()).toEqual(marker);
  db.exec("DROP TRIGGER reject_progress");
  run_project_database_migrations(db, "1.0.0");
  expect(JSON.parse(String(db.prepare("SELECT data FROM items").get()!.data))).toEqual({
    src: "旧原文",
    dst: "保留译文",
    name_dst: "保留译名",
    status: "NONE",
  });
  expect(read_marker()).toEqual(applied);
});
