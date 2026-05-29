import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnalysisCheckpointStatusMigration } from "./analysis-checkpoint-status-migration";

let temp_dir = "";
let databases: DatabaseSync[] = [];

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-checkpoint-migration-"));
  databases = [];
});

afterEach(() => {
  for (const db of databases) {
    db.close();
  }
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("AnalysisCheckpointStatusMigration", () => {
  it("把旧分析 checkpoint 状态写回任务进度三态", () => {
    const db = open_database("checkpoints.lg");
    db.exec(`
      CREATE TABLE analysis_item_checkpoint (
        item_id INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error_count INTEGER NOT NULL
      );
      INSERT INTO analysis_item_checkpoint (item_id, status, updated_at, error_count)
      VALUES (1, 'PROCESSED_IN_PAST', '2026-01-01', 0);
      INSERT INTO analysis_item_checkpoint (item_id, status, updated_at, error_count)
      VALUES (2, 'PROCESSING', '2026-01-01', 0);
      INSERT INTO analysis_item_checkpoint (item_id, status, updated_at, error_count)
      VALUES (3, 'BROKEN', '2026-01-01', 0);
    `);

    AnalysisCheckpointStatusMigration.run(db);

    expect(
      db
        .prepare("SELECT item_id, status FROM analysis_item_checkpoint ORDER BY item_id")
        .all()
        .map((row) => ({ item_id: Number(row["item_id"]), status: String(row["status"]) })),
    ).toEqual([
      { item_id: 1, status: "PROCESSED" },
      { item_id: 2, status: "NONE" },
      { item_id: 3, status: "NONE" },
    ]);
  });
});

/**
 * checkpoint 状态迁移测试用真实表，直接观察 status 列写回结果。
 */
function open_database(name: string): DatabaseSync {
  const db = new DatabaseSync(path.join(temp_dir, name));
  databases.push(db);
  return db;
}
