import fs from "node:fs";
import path from "node:path";

import type { ApiJsonValue } from "../api/api-types";
import type { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue } from "../database/database-types";
import type { CoreBridgeClient } from "../core/core-bridge-client";
import { ProjectSessionState } from "./project-session-state";

const SUPPORTED_SOURCE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".xlsx",
  ".epub",
  ".ass",
  ".srt",
  ".rpy",
  ".trans",
]);

type JsonRecord = Record<string, DatabaseJsonValue | ApiJsonValue | undefined>;

/**
 * 承载已迁移的项目轻生命周期公开接口，公开 loaded/path 由 TS 会话状态持有。
 */
export class ProjectLifecycleService {
  public constructor(
    private readonly database: ProjectDatabase,
    private readonly core_bridge: CoreBridgeClient,
    private readonly session_state: ProjectSessionState,
  ) {}

  /**
   * 读取当前工程快照；公开 loaded/path 只来自 TS 会话权威。
   */
  public async get_project_snapshot(): Promise<Record<string, ApiJsonValue>> {
    const state = this.session_state.snapshot();
    return {
      project: {
        path: state.projectPath,
        loaded: state.loaded,
      },
    };
  }

  /**
   * 经内部桥触发 Python 真卸载，再释放 TS database 缓存句柄。
   */
  public async unload_project(): Promise<Record<string, ApiJsonValue>> {
    const state = this.session_state.snapshot();
    await this.core_bridge.unload_project();
    this.session_state.clear();
    if (state.loaded && state.projectPath !== "") {
      this.database.execute({
        name: "closeProject",
        args: { projectPath: state.projectPath },
      });
    }
    return {
      project: {
        path: "",
        loaded: false,
      },
    };
  }

  /**
   * 读取 .lg 摘要预览，不加载 Python ProjectSession。
   */
  public get_project_preview(body: Record<string, ApiJsonValue>): Record<string, ApiJsonValue> {
    const project_path = this.require_body_string(body, "path");
    if (!fs.existsSync(project_path)) {
      const error = new Error(`工程文件不存在：${project_path}`) as Error & { code: string };
      error.code = "ENOENT";
      throw error;
    }
    const summary = this.to_record(
      this.database.execute({
        name: "getProjectSummary",
        args: { projectPath: project_path },
      }),
    );
    return {
      preview: {
        path: project_path,
        name: this.string_field(summary, "name"),
        source_language: this.string_field(summary, "source_language"),
        target_language: this.string_field(summary, "target_language"),
        file_count: this.number_field(summary, "file_count"),
        created_at: this.string_field(summary, "created_at"),
        updated_at: this.string_field(summary, "updated_at"),
        translation_stats: this.normalize_translation_stats(summary["translation_stats"]),
      },
    };
  }

  /**
   * 按用户选择顺序枚举可导入源文件，保持源路径去重和真实文件去重一致。
   */
  public collect_source_files(body: Record<string, ApiJsonValue>): Record<string, ApiJsonValue> {
    const source_paths = this.normalize_source_paths(body["source_paths"]);
    const source_files: string[] = [];
    const seen_file_keys = new Set<string>();
    for (const source_path of source_paths) {
      for (const source_file of this.collect_source_files_from_path(source_path)) {
        const file_key = this.build_path_identity_key(source_file);
        if (seen_file_keys.has(file_key)) {
          continue;
        }
        seen_file_keys.add(file_key);
        source_files.push(source_file);
      }
    }
    return { source_files };
  }

  private normalize_source_paths(value: ApiJsonValue | undefined): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const normalized_paths: string[] = [];
    const seen_keys = new Set<string>();
    for (const raw_path of value) {
      if (typeof raw_path !== "string") {
        continue;
      }
      const source_path = raw_path.trim();
      if (source_path === "") {
        continue;
      }
      const path_key = this.build_path_identity_key(source_path);
      if (seen_keys.has(path_key)) {
        continue;
      }
      seen_keys.add(path_key);
      normalized_paths.push(source_path);
    }
    return normalized_paths;
  }

  private collect_source_files_from_path(source_path: string): string[] {
    if (!fs.existsSync(source_path)) {
      return [];
    }
    const stats = fs.statSync(source_path);
    if (stats.isFile()) {
      return this.is_supported_file(source_path) ? [source_path] : [];
    }
    if (!stats.isDirectory()) {
      return [];
    }
    return this.collect_source_files_from_directory(source_path);
  }

  private collect_source_files_from_directory(source_path: string): string[] {
    const source_files: string[] = [];
    const entries = fs
      .readdirSync(source_path, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entry_path = path.join(source_path, entry.name);
      if (entry.isDirectory()) {
        source_files.push(...this.collect_source_files_from_directory(entry_path));
      } else if (entry.isFile() && this.is_supported_file(entry_path)) {
        source_files.push(entry_path);
      }
    }
    return source_files;
  }

  private is_supported_file(file_path: string): boolean {
    return SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(file_path).toLowerCase());
  }

  private build_path_identity_key(source_path: string): string {
    const resolved_path = path.resolve(source_path);
    return process.platform === "win32" ? resolved_path.toLowerCase() : resolved_path;
  }

  private require_body_string(body: Record<string, ApiJsonValue>, key: string): string {
    const value = body[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`请求字段 ${key} 必须是非空字符串。`);
    }
    return value;
  }

  private normalize_translation_stats(value: DatabaseJsonValue | ApiJsonValue | undefined) {
    const stats = this.to_record(value);
    return {
      total_items: this.number_field(stats, "total_items"),
      completed_count: this.number_field(stats, "completed_count"),
      failed_count: this.number_field(stats, "failed_count"),
      pending_count: this.number_field(stats, "pending_count"),
      skipped_count: this.number_field(stats, "skipped_count"),
      completion_percent: this.number_field(stats, "completion_percent"),
    };
  }

  private to_record(value: DatabaseJsonValue | ApiJsonValue | undefined): JsonRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return value as JsonRecord;
  }

  private string_field(record: JsonRecord, key: string): string {
    const value = record[key];
    return typeof value === "string" ? value : String(value ?? "");
  }

  private number_field(record: JsonRecord, key: string): number {
    const value = record[key];
    return typeof value === "number" ? value : Number(value ?? 0);
  }
}
