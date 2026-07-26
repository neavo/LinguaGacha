import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZstdTool } from "../../shared/utils/zstd-tool";
import {
  PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
  PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS,
} from "../migration/migration-orchestrator";
import { ProjectDatabase } from "./database-operations";

let temp_dir = "";
let cleanup_databases: ProjectDatabase[] = [];

function project_path(name: string): string {
  return path.join(temp_dir, name);
}

function create_database(): ProjectDatabase {
  const database = new ProjectDatabase();
  cleanup_databases.push(database);
  return database;
}

function create_database_project(name: string): { database: ProjectDatabase; lg_path: string } {
  const database = create_database();
  const lg_path = project_path(`${name}.lg`);
  database.create_project(lg_path, name);
  return { database, lg_path };
}

function read_meta(
  database: ProjectDatabase,
  project_path: string,
  key: string,
  default_value: unknown,
): unknown {
  return (database.get_all_meta(project_path) as Record<string, unknown>)[key] ?? default_value;
}

function project_sidecar_paths(lg_path: string): string[] {
  return [`${lg_path}-wal`, `${lg_path}-shm`];
}

function has_project_sidecar(lg_path: string): boolean {
  return project_sidecar_paths(lg_path).some((sidecar_path) => fs.existsSync(sidecar_path));
}

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-database-"));
  cleanup_databases = [];
});

afterEach(() => {
  for (const database of cleanup_databases.splice(0)) {
    database.close();
  }
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProjectDatabase", () => {
  it("创建工程并读写 meta", () => {
    const database = create_database();
    const lg_path = project_path("demo.lg");

    database.create_project(lg_path, "demo");
    database.set_meta(lg_path, "source_language", "JA");

    expect(read_meta(database, lg_path, "source_language", "")).toBe("JA");
    expect(
      read_meta(database, lg_path, PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY, []),
    ).toEqual(PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS);
    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("普通 scoped 操作结束后不常驻 WAL 副文件", () => {
    const database = create_database();
    const lg_path = project_path("scoped.lg");

    database.create_project(lg_path, "scoped");
    database.set_meta(lg_path, "target_language", "ZH");
    read_meta(database, lg_path, "target_language", "");

    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("关闭工程后迟到的租约释放不会二次关闭连接", () => {
    const database = create_database();
    const lg_path = project_path("lease-close.lg");

    database.create_project(lg_path, "lease-close");
    const release = database.acquire_project_lease(lg_path, "test");
    database.set_meta(lg_path, "source_language", "JA");

    database.close_project(lg_path);

    expect(() => release()).not.toThrow();
    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("显式租约期间保留连接，释放后清理 WAL 副文件", () => {
    const database = create_database();
    const lg_path = project_path("lease.lg");

    database.create_project(lg_path, "lease");
    const release = database.acquire_project_lease(lg_path, "test");
    database.set_meta(lg_path, "source_language", "JA");

    expect(has_project_sidecar(lg_path)).toBe(true);
    release();
    release();

    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("由 服务层读取源文件、压缩 asset，并通过 ProjectDatabase 返回原始 bytes", () => {
    const database = create_database();
    const lg_path = project_path("asset.lg");
    const source_path = project_path("source.txt");
    fs.writeFileSync(source_path, Buffer.from("hello"));

    database.create_project(lg_path, "asset");
    database.add_asset_from_source(lg_path, "source.txt", source_path, 0);

    expect(database.read_asset_content(lg_path, "source.txt")).toEqual(Buffer.from("hello"));
  });

  it("事务失败时回滚已排队写入", () => {
    const database = create_database();
    const lg_path = project_path("rollback.lg");
    database.create_project(lg_path, "rollback");

    expect(() =>
      database.transaction(lg_path, () => {
        database.set_meta(lg_path, "target_language", "ZH");
        throw new Error("rollback");
      }),
    ).toThrow("rollback");

    expect(read_meta(database, lg_path, "target_language", "missing")).toBe("missing");
  });

  it("创建工程事务失败时先结束 scoped 连接再删除新文件", () => {
    const database = create_database();
    const lg_path = project_path("create-rollback.lg");

    expect(() =>
      database.create_project(lg_path, "create-rollback", () => {
        database.set_meta(lg_path, "target_language", "ZH");
        throw new Error("rollback");
      }),
    ).toThrow("rollback");

    expect(fs.existsSync(lg_path)).toBe(false);
    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("只推进受支持的section revision，并忽略重复 section", () => {
    const { database, lg_path } = create_database_project("section-revision");

    expect(
      database.bump_section_revisions(lg_path, ["items", "files", "items", "project", "analysis"]),
    ).toEqual({ items: 1, files: 1, analysis: 1 });
    expect(database.bump_section_revisions(lg_path, ["items"])).toEqual({ items: 2 });
    expect(database.get_all_meta(lg_path)).toMatchObject({
      "project_runtime_revision.items": 2,
      "project_runtime_revision.files": 1,
      "project_runtime_revision.analysis": 1,
    });
  });

  it("按排序快照维护 asset，并可更新和读取内容", () => {
    const { database, lg_path } = create_database_project("asset-list");
    const alpha_path = project_path("alpha.txt");
    const beta_path = project_path("beta.txt");
    const cover_path = project_path("cover.bin");
    const updated_beta_path = project_path("updated-beta.txt");
    fs.writeFileSync(alpha_path, Buffer.from("alpha"));
    fs.writeFileSync(beta_path, Buffer.from("beta"));
    fs.writeFileSync(cover_path, Buffer.from("cover"));
    fs.writeFileSync(updated_beta_path, Buffer.from("updated-beta"));

    database.add_asset_from_source(lg_path, "chapter-b.txt", beta_path, 10);
    database.add_asset_from_source(lg_path, "chapter-a.txt", alpha_path);
    database.add_asset_from_source(lg_path, "cover.bin", cover_path, 0);
    database.update_asset_sort_orders(lg_path, ["chapter-a.txt", "cover.bin", "chapter-b.txt"]);
    database.update_asset_from_source(lg_path, "chapter-b.txt", updated_beta_path);

    expect(database.get_asset_count(lg_path)).toBe(3);
    expect(database.get_all_asset_records(lg_path)).toEqual([
      { path: "chapter-a.txt", sort_order: 0 },
      { path: "cover.bin", sort_order: 1 },
      { path: "chapter-b.txt", sort_order: 2 },
    ]);
    expect(database.read_asset_content(lg_path, "chapter-b.txt")).toEqual(
      Buffer.from("updated-beta"),
    );
  });

  it("批量替换 item 后保持回查顺序并支持字段补丁", () => {
    const { database, lg_path } = create_database_project("items");

    expect(
      database.set_items(lg_path, [
        { id: 10, file_path: "script-a.txt", src: "おはよう", status: "NONE" },
        { file_path: "script-b.txt", src: "こんばんは", status: "PROCESSED" },
      ]),
    ).toEqual([10, 11]);
    expect(database.get_item_count(lg_path)).toBe(2);
    database.patch_item_fields_by_ids(lg_path, [10], { status: "PROCESSED" });
    expect(database.get_items_by_ids(lg_path, [11, 10, 11, 999])).toEqual([
      { id: 11, file_path: "script-b.txt", src: "こんばんは", status: "PROCESSED" },
      { id: 10, file_path: "script-a.txt", src: "おはよう", status: "PROCESSED" },
    ]);
  });

  it("事务同步写入 item、规则和 meta，并让工程摘要反映当前事实", () => {
    const { database, lg_path } = create_database_project("summary");
    const source_path = project_path("chapter.txt");
    fs.writeFileSync(source_path, "chapter");

    database.add_asset_from_source(lg_path, "chapter.txt", source_path, 0);
    database.set_items(lg_path, [
      { id: 1, src: "完成", status: "PROCESSED" },
      { id: 2, src: "失败后修复", status: "ERROR" },
      { id: 3, src: "待处理", status: "NONE" },
      { id: 4, src: "跳过", status: "SKIPPED" },
    ]);
    database.set_rule_text(lg_path, "prompt.translation", "请保持语气");
    database.transaction(lg_path, () => {
      database.patch_item_fields_by_ids(lg_path, [2], { status: "PROCESSED" });
      database.set_rules(lg_path, "glossary", [{ src: "姫", dst: "公主" }]);
      database.upsert_meta_entries(lg_path, {
        source_language: "JA",
        target_language: "ZH_CN",
        updated_at: "2026-05-16T00:00:00.000Z",
      });
    });

    expect(database.get_rule_text(lg_path, "prompt.translation")).toBe("请保持语气");
    expect(database.get_rules(lg_path, "glossary")).toEqual([{ src: "姫", dst: "公主" }]);
    expect(database.get_project_summary(lg_path)).toEqual(
      expect.objectContaining({
        name: "summary",
        source_language: "JA",
        target_language: "ZH_CN",
        updated_at: "2026-05-16T00:00:00.000Z",
        file_count: 1,
        translation_stats: {
          total_items: 4,
          completed_count: 2,
          failed_count: 0,
          pending_count: 1,
          skipped_count: 1,
          completion_percent: 75,
        },
      }),
    );
  });

  it("patchItemTranslationFields 只更新译文字段并保留条目持久事实", () => {
    const { database, lg_path } = create_database_project("translation-patch");

    database.set_items(lg_path, [
      {
        id: 1,
        src: "原文",
        dst: "",
        name_src: "原名",
        name_dst: null,
        status: "NONE",
        retry_count: 2,
        file_path: "demo.txt",
        file_type: "TXT",
        text_type: "TXT",
        row: 7,
        extra_field: { speaker: "春" },
      },
    ]);

    database.patch_item_translation_fields(lg_path, [
      {
        id: 1,
        patch: {
          dst: "译文",
          name_dst: ["译名"],
          status: "PROCESSED",
          retry_count: 0,
        },
      },
    ]);

    expect(database.get_all_items(lg_path)).toEqual([
      {
        id: 1,
        src: "原文",
        dst: "译文",
        name_src: "原名",
        name_dst: ["译名"],
        status: "PROCESSED",
        retry_count: 0,
        file_path: "demo.txt",
        file_type: "TXT",
        text_type: "TXT",
        row: 7,
        extra_field: { speaker: "春" },
      },
    ]);
  });

  it("保存分析断点和候选聚合后可按状态与原文读取当前事实", () => {
    const { database, lg_path } = create_database_project("analysis");

    database.upsert_analysis_item_checkpoints(lg_path, [
      { item_id: 1, status: "pending", updated_at: "2026-05-16T00:00:00.000Z", error_count: 0 },
      { item_id: 2, status: "failed", updated_at: "2026-05-16T00:01:00.000Z", error_count: 2 },
    ]);
    database.upsert_analysis_item_checkpoints(lg_path, [
      { item_id: 2, status: "done", updated_at: "2026-05-16T00:02:00.000Z", error_count: 0 },
    ]);
    database.upsert_analysis_candidate_aggregates(lg_path, [
      {
        src: "姫",
        dst_votes: { princess: 2 },
        info_votes: { name: 1 },
        observation_count: 2,
        first_seen_at: "2026-05-16T00:00:00.000Z",
        last_seen_at: "2026-05-16T00:02:00.000Z",
        case_sensitive: true,
      },
      {
        src: "王",
        dst_votes: { king: 1 },
        info_votes: {},
        observation_count: 1,
        first_seen_at: "2026-05-16T00:03:00.000Z",
        last_seen_at: "2026-05-16T00:03:00.000Z",
        case_sensitive: false,
      },
    ]);

    expect(database.get_analysis_item_checkpoints(lg_path)).toEqual([
      { item_id: 1, status: "pending", updated_at: "2026-05-16T00:00:00.000Z", error_count: 0 },
      { item_id: 2, status: "done", updated_at: "2026-05-16T00:02:00.000Z", error_count: 0 },
    ]);
    expect(database.delete_analysis_item_checkpoints(lg_path, "pending")).toBe(1);
    expect(database.get_analysis_item_checkpoints(lg_path)).toEqual([
      { item_id: 2, status: "done", updated_at: "2026-05-16T00:02:00.000Z", error_count: 0 },
    ]);
    expect(
      database.get_analysis_candidate_aggregates_by_srcs(lg_path, [" 姫 ", "", "missing"]),
    ).toEqual([
      {
        src: "姫",
        dst_votes: { princess: 2 },
        info_votes: { name: 1 },
        observation_count: 2,
        first_seen_at: "2026-05-16T00:00:00.000Z",
        last_seen_at: "2026-05-16T00:02:00.000Z",
        case_sensitive: true,
      },
    ]);

    database.delete_analysis_candidate_aggregates_by_srcs(lg_path, [" 姫 ", "", "missing", "姫"]);
    expect(database.get_analysis_candidate_aggregates(lg_path)).toEqual([
      {
        src: "王",
        dst_votes: { king: 1 },
        info_votes: {},
        observation_count: 1,
        first_seen_at: "2026-05-16T00:03:00.000Z",
        last_seen_at: "2026-05-16T00:03:00.000Z",
        case_sensitive: false,
      },
    ]);

    database.clear_analysis_candidate_aggregates(lg_path);
    expect(database.get_analysis_candidate_aggregates(lg_path)).toEqual([]);
  });

  it("兼容读取旧压缩 asset bytes", () => {
    const lg_path = project_path("legacy-asset.lg");
    const db = new DatabaseSync(lg_path);
    const compressed = ZstdTool.compress(Buffer.from("legacy"));
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        data BLOB NOT NULL,
        original_size INTEGER NOT NULL,
        compressed_size INTEGER NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO assets (path, data, original_size, compressed_size) VALUES (?, ?, ?, ?)",
    ).run("legacy.txt", compressed, 6, compressed.byteLength);
    db.close();

    const database = create_database();
    expect(database.read_asset_content(lg_path, "legacy.txt")).toEqual(Buffer.from("legacy"));
  });
});
