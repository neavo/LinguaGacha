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
  database.execute({
    name: "createProject",
    args: { projectPath: lg_path, name },
  });
  return { database, lg_path };
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

    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "demo" },
    });
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "source_language", value: "JA" },
    });

    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "source_language", default: "" },
      }),
    ).toBe("JA");
    expect(
      database.execute({
        name: "getMeta",
        args: {
          projectPath: lg_path,
          key: PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
          default: [],
        },
      }),
    ).toEqual(PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS);
    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("普通 scoped 操作结束后不常驻 WAL 副文件", () => {
    const database = create_database();
    const lg_path = project_path("scoped.lg");

    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "scoped" },
    });
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "target_language", value: "ZH" },
    });
    database.execute({
      name: "getMeta",
      args: { projectPath: lg_path, key: "target_language", default: "" },
    });

    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("关闭工程后迟到的租约释放不会二次关闭连接", () => {
    const database = create_database();
    const lg_path = project_path("lease-close.lg");

    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "lease-close" },
    });
    const release = database.acquire_project_lease(lg_path, "test");
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "source_language", value: "JA" },
    });

    database.execute({
      name: "closeProject",
      args: { projectPath: lg_path },
    });

    expect(() => release()).not.toThrow();
    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("显式租约期间保留连接，释放后清理 WAL 副文件", () => {
    const database = create_database();
    const lg_path = project_path("lease.lg");

    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "lease" },
    });
    const release = database.acquire_project_lease(lg_path, "test");
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "source_language", value: "JA" },
    });

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

    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "asset" },
    });
    database.execute({
      name: "addAssetFromSource",
      args: {
        projectPath: lg_path,
        path: "source.txt",
        sourcePath: source_path,
        sortOrder: 0,
      },
    });

    expect(database.read_asset_content(lg_path, "source.txt")).toEqual(Buffer.from("hello"));
  });

  it("事务失败时回滚已排队写入", () => {
    const database = create_database();
    const lg_path = project_path("rollback.lg");
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "rollback" },
    });

    expect(() =>
      database.execute_transaction([
        {
          name: "setMeta",
          args: { projectPath: lg_path, key: "target_language", value: "ZH" },
        },
        {
          name: "missingOperation",
          args: { projectPath: lg_path },
        },
      ]),
    ).toThrow("runtime.internal_invariant");

    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "target_language", default: "missing" },
      }),
    ).toBe("missing");
  });

  it("创建工程事务失败时先结束 scoped 连接再删除新文件", () => {
    const database = create_database();
    const lg_path = project_path("create-rollback.lg");

    expect(() =>
      database.execute_transaction([
        {
          name: "createProject",
          args: { projectPath: lg_path, name: "create-rollback" },
        },
        {
          name: "setMeta",
          args: { projectPath: lg_path, key: "target_language", value: "ZH" },
        },
        {
          name: "missingOperation",
          args: { projectPath: lg_path },
        },
      ]),
    ).toThrow("runtime.internal_invariant");

    expect(fs.existsSync(lg_path)).toBe(false);
    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("事务拒绝跨工程写入，避免两个 .lg 出现半提交", () => {
    const database = create_database();
    const first_path = project_path("first.lg");
    const second_path = project_path("second.lg");
    database.execute({
      name: "createProject",
      args: { projectPath: first_path, name: "first" },
    });
    database.execute({
      name: "createProject",
      args: { projectPath: second_path, name: "second" },
    });

    expect(() =>
      database.execute_transaction([
        {
          name: "setMeta",
          args: { projectPath: first_path, key: "source_language", value: "JA" },
        },
        {
          name: "setMeta",
          args: { projectPath: second_path, key: "target_language", value: "ZH" },
        },
      ]),
    ).toThrow("runtime.internal_invariant");

    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: first_path, key: "source_language", default: "missing" },
      }),
    ).toBe("missing");
    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: second_path, key: "target_language", default: "missing" },
      }),
    ).toBe("missing");
  });

  it("只推进受支持的运行态 section revision，并忽略重复 section", () => {
    const { database, lg_path } = create_database_project("runtime-revision");

    expect(
      database.execute({
        name: "bumpRuntimeSectionRevisions",
        args: {
          projectPath: lg_path,
          sections: ["items", "files", "items", "project", "analysis"],
        },
      }),
    ).toEqual({ items: 1, files: 1, analysis: 1 });
    expect(
      database.execute({
        name: "bumpRuntimeSectionRevisions",
        args: { projectPath: lg_path, sections: ["items"] },
      }),
    ).toEqual({ items: 2 });
    expect(database.execute({ name: "getAllMeta", args: { projectPath: lg_path } })).toMatchObject({
      "project_runtime_revision.items": 2,
      "project_runtime_revision.files": 1,
      "project_runtime_revision.analysis": 1,
    });
  });

  it("按排序快照维护 asset 路径、数量和压缩载荷", () => {
    const { database, lg_path } = create_database_project("asset-list");
    const alpha_path = project_path("alpha.txt");
    const beta_path = project_path("beta.txt");
    fs.writeFileSync(alpha_path, Buffer.from("alpha"));
    fs.writeFileSync(beta_path, Buffer.from("beta"));

    database.execute({
      name: "addAssetFromSource",
      args: { projectPath: lg_path, path: "chapter-b.txt", sourcePath: beta_path, sortOrder: 10 },
    });
    database.execute({
      name: "addAssetFromSource",
      args: { projectPath: lg_path, path: "chapter-a.txt", sourcePath: alpha_path },
    });
    database.execute({
      name: "addAssetCompressedBase64",
      args: {
        projectPath: lg_path,
        path: "cover.bin",
        compressedBase64: ZstdTool.compress(Buffer.from("cover")).toString("base64"),
        originalSize: 5,
        sortOrder: 0,
      },
    });
    database.execute({
      name: "updateAssetSortOrders",
      args: { projectPath: lg_path, orderedPaths: ["chapter-a.txt", "cover.bin", "chapter-b.txt"] },
    });
    database.execute({
      name: "updateAssetPath",
      args: {
        projectPath: lg_path,
        oldPath: "chapter-b.txt",
        newPath: "chapter-renamed.txt",
      },
    });

    expect(database.execute({ name: "getAssetCount", args: { projectPath: lg_path } })).toBe(3);
    expect(database.execute({ name: "getAllAssetPaths", args: { projectPath: lg_path } })).toEqual([
      "chapter-a.txt",
      "cover.bin",
      "chapter-renamed.txt",
    ]);
    expect(
      database.execute({ name: "getAllAssetRecords", args: { projectPath: lg_path } }),
    ).toEqual([
      { path: "chapter-a.txt", sort_order: 0 },
      { path: "cover.bin", sort_order: 1 },
      { path: "chapter-renamed.txt", sort_order: 2 },
    ]);
    expect(
      database.execute({
        name: "assetPathExists",
        args: { projectPath: lg_path, path: "chapter-b.txt" },
      }),
    ).toBe(false);
    expect(
      database.execute({
        name: "assetPathExists",
        args: { projectPath: lg_path, path: "chapter-renamed.txt" },
      }),
    ).toBe(true);

    const compressed_base64 = database.execute({
      name: "getAssetCompressedBase64",
      args: { projectPath: lg_path, path: "chapter-renamed.txt" },
    });
    expect(ZstdTool.decompress(Buffer.from(String(compressed_base64), "base64"))).toEqual(
      Buffer.from("beta"),
    );
  });

  it("批量替换 item 后保持回查顺序、预览 id 不落库，并按文件路径删除", () => {
    const { database, lg_path } = create_database_project("items");

    expect(
      database.execute({
        name: "setItems",
        args: {
          projectPath: lg_path,
          items: [
            { id: 10, file_path: "script-a.txt", src: "おはよう", status: "NONE" },
            { file_path: "script-b.txt", src: "こんばんは", status: "PROCESSED" },
          ],
        },
      }),
    ).toEqual([10, 11]);
    expect(
      database.execute({
        name: "previewReplaceAllItemIds",
        args: {
          projectPath: lg_path,
          items: [{ src: "preview-a" }, { id: 5, src: "kept" }, { src: "preview-b" }],
        },
      }),
    ).toEqual([12, 5, 13]);

    expect(database.execute({ name: "getItemCount", args: { projectPath: lg_path } })).toBe(2);
    expect(
      database.execute({
        name: "setItem",
        args: {
          projectPath: lg_path,
          item: { id: 10, file_path: "script-a.txt", src: "おはよう", status: "PROCESSED" },
        },
      }),
    ).toBe(10);
    expect(
      database.execute({
        name: "getItemsByIds",
        args: { projectPath: lg_path, itemIds: [11, 10, 11, 999] },
      }),
    ).toEqual([
      { id: 11, file_path: "script-b.txt", src: "こんばんは", status: "PROCESSED" },
      { id: 10, file_path: "script-a.txt", src: "おはよう", status: "PROCESSED" },
    ]);

    expect(
      database.execute({
        name: "deleteItemsByFilePath",
        args: { projectPath: lg_path, filePath: "script-a.txt" },
      }),
    ).toBe(1);
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      { id: 11, file_path: "script-b.txt", src: "こんばんは", status: "PROCESSED" },
    ]);
  });

  it("updateBatch 同步写入 item、规则和 meta，并让工程摘要反映当前事实", () => {
    const { database, lg_path } = create_database_project("summary");

    database.execute({
      name: "addAssetCompressedBase64",
      args: {
        projectPath: lg_path,
        path: "chapter.txt",
        compressedBase64: ZstdTool.compress(Buffer.from("chapter")).toString("base64"),
        originalSize: 7,
        sortOrder: 0,
      },
    });
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          { id: 1, src: "完成", status: "PROCESSED" },
          { id: 2, src: "失败后修复", status: "ERROR" },
          { id: 3, src: "待处理", status: "NONE" },
          { id: 4, src: "跳过", status: "SKIPPED" },
        ],
      },
    });
    database.execute({
      name: "setRuleText",
      args: { projectPath: lg_path, ruleType: "prompt.translation", text: "请保持语气" },
    });
    database.execute({
      name: "updateBatch",
      args: {
        projectPath: lg_path,
        items: [{ id: 2, src: "失败后修复", status: "PROCESSED" }],
        rules: { glossary: [{ src: "姫", dst: "公主" }] },
        meta: {
          source_language: "JA",
          target_language: "ZH_CN",
          updated_at: "2026-05-16T00:00:00.000Z",
        },
      },
    });

    expect(
      database.execute({
        name: "getRuleText",
        args: { projectPath: lg_path, ruleType: "prompt.translation" },
      }),
    ).toBe("请保持语气");
    expect(
      database.execute({
        name: "getRuleTextByName",
        args: { projectPath: lg_path, ruleTypeName: "prompt.translation" },
      }),
    ).toBe("请保持语气");
    expect(
      database.execute({ name: "getRules", args: { projectPath: lg_path, ruleType: "glossary" } }),
    ).toEqual([{ src: "姫", dst: "公主" }]);
    expect(database.execute({ name: "getProjectSummary", args: { projectPath: lg_path } })).toEqual(
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

  it("保存分析断点和候选聚合后可按状态与原文读取当前事实", () => {
    const { database, lg_path } = create_database_project("analysis");

    database.execute({
      name: "upsertAnalysisItemCheckpoints",
      args: {
        projectPath: lg_path,
        checkpoints: [
          { item_id: 1, status: "pending", updated_at: "2026-05-16T00:00:00.000Z", error_count: 0 },
          { item_id: 2, status: "failed", updated_at: "2026-05-16T00:01:00.000Z", error_count: 2 },
        ],
      },
    });
    database.execute({
      name: "upsertAnalysisItemCheckpoints",
      args: {
        projectPath: lg_path,
        checkpoints: [
          { item_id: 2, status: "done", updated_at: "2026-05-16T00:02:00.000Z", error_count: 0 },
        ],
      },
    });
    database.execute({
      name: "upsertAnalysisCandidateAggregates",
      args: {
        projectPath: lg_path,
        aggregates: [
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
        ],
      },
    });

    expect(
      database.execute({ name: "getAnalysisItemCheckpoints", args: { projectPath: lg_path } }),
    ).toEqual([
      { item_id: 1, status: "pending", updated_at: "2026-05-16T00:00:00.000Z", error_count: 0 },
      { item_id: 2, status: "done", updated_at: "2026-05-16T00:02:00.000Z", error_count: 0 },
    ]);
    expect(
      database.execute({
        name: "deleteAnalysisItemCheckpoints",
        args: { projectPath: lg_path, status: "pending" },
      }),
    ).toBe(1);
    expect(
      database.execute({ name: "getAnalysisItemCheckpoints", args: { projectPath: lg_path } }),
    ).toEqual([
      { item_id: 2, status: "done", updated_at: "2026-05-16T00:02:00.000Z", error_count: 0 },
    ]);
    expect(
      database.execute({
        name: "getAnalysisCandidateAggregatesBySrcs",
        args: { projectPath: lg_path, srcs: [" 姫 ", "", "missing"] },
      }),
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

    database.execute({
      name: "deleteAnalysisCandidateAggregatesBySrcs",
      args: { projectPath: lg_path, srcs: [" 姫 ", "", "missing", "姫"] },
    });
    expect(
      database.execute({ name: "getAnalysisCandidateAggregates", args: { projectPath: lg_path } }),
    ).toEqual([
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

    database.execute({ name: "clearAnalysisCandidateAggregates", args: { projectPath: lg_path } });
    expect(
      database.execute({ name: "getAnalysisCandidateAggregates", args: { projectPath: lg_path } }),
    ).toEqual([]);
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
