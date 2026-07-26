import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { run_analysis_checkpoint_status_migration } from "./analysis-checkpoint-status-migration";

describe("run_analysis_checkpoint_status_migration", () => {
  it("把旧分析 checkpoint 状态写回任务进度三态", () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-checkpoint-migration-"),
    );
    using db = new DatabaseSync(path.join(temp_dir.path, "checkpoints.lg"));
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

    run_analysis_checkpoint_status_migration(db);

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
