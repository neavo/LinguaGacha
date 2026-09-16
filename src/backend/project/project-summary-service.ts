import type { ProjectDatabase } from "../database/database-operations";
import type { ProjectItemPublicRecord } from "../../domain/item";
import type { JsonValue, MutableJsonRecord } from "../../domain/json";
import type {
  ProjectTranslationStats,
  ProjectTranslationStatsResponse,
} from "../../shared/project-translation-stats";
import type { CacheFileEntry, CacheReadPort } from "../cache/cache-types";

import type { ProjectSessionState } from "./project-session-state";

const COMPLETED_STATUSES = new Set(["PROCESSED"]);
const FAILED_STATUSES = new Set(["ERROR"]);
const SKIPPED_STATUSES = new Set(["EXCLUDED", "RULE_SKIPPED", "LANGUAGE_SKIPPED", "DUPLICATED"]);

/**
 * 后端查询服务从 cache 门面读取热数据，并返回页面级快照。
 */
export class ProjectSummaryService {
  private readonly session_state: ProjectSessionState;
  private readonly cache: CacheReadPort;

  /**
   * session_state 提供工程身份，cache 提供当前项目热读事实。
   */
  public constructor(
    session_state: ProjectSessionState,
    cache: CacheReadPort,
    private readonly database: Pick<ProjectDatabase, "read_pdf_summaries">,
  ) {
    this.session_state = session_state;
    this.cache = cache;
  }

  /**
   * 工作台快照承接文件列表，跨页面翻译统计由独立查询提供。
   */
  public read(): MutableJsonRecord {
    const project_path = this.session_state.require_loaded_project_path();
    const items = this.cache.items.readItems();
    const file_entries = this.build_file_entries(items, this.cache.files.readFileEntries());
    const pdf = file_entries.some((entry) => entry["file_type"] === "PDF")
      ? this.database.read_pdf_summaries(project_path)
      : {};
    return {
      projectPath: project_path,
      sectionRevisions: this.cache.readSectionRevisions() as unknown as JsonValue,
      snapshot: {
        entries: file_entries.map((entry) => ({
          ...entry,
          ...(pdf[String(entry["rel_path"])] ? { pdf: pdf[String(entry["rel_path"])] } : {}),
        })) as unknown as JsonValue,
      },
    };
  }

  /** 工程身份随统计返回，供共享缓存隔离切换期间的响应。 */
  public read_translation_stats(): ProjectTranslationStatsResponse {
    const projectPath = this.session_state.require_loaded_project_path();
    return {
      projectPath,
      stats: this.build_item_stats(this.cache.items.readItems()),
    };
  }

  /**
   * 按文件路径聚合项目列表和文件条目数。
   */
  private build_file_entries(
    items: ProjectItemPublicRecord[],
    cached_file_entries: CacheFileEntry[],
  ): MutableJsonRecord[] {
    const entries_by_path = new Map<string, ProjectItemPublicRecord[]>();
    for (const item of items) {
      const file_path = String(item["file_path"] ?? "");
      if (file_path === "") {
        continue;
      }
      const bucket = entries_by_path.get(file_path) ?? [];
      bucket.push(item);
      entries_by_path.set(file_path, bucket);
    }
    const emitted_paths = new Set<string>();
    const result: MutableJsonRecord[] = [];
    for (const file_entry of cached_file_entries) {
      const rel_path = file_entry.rel_path;
      const file_items = entries_by_path.get(rel_path) ?? [];
      emitted_paths.add(rel_path);
      result.push(this.build_project_file_entry(file_entry, file_items));
    }
    for (const [rel_path, file_items] of entries_by_path.entries()) {
      if (emitted_paths.has(rel_path)) {
        continue;
      }
      result.push(
        this.build_project_file_entry(
          {
            rel_path,
            file_type: String(file_items[0]?.["file_type"] ?? "NONE"),
            sort_index: result.length,
          },
          file_items,
        ),
      );
    }
    return result;
  }

  /**
   * FileCache 已过滤空路径并归一序号，项目文件行补充条目数及非负展示顺序。
   */
  private build_project_file_entry(
    file_entry: CacheFileEntry,
    file_items: ProjectItemPublicRecord[],
  ): MutableJsonRecord {
    return {
      rel_path: file_entry.rel_path,
      file_type: file_entry.file_type,
      sort_index: Math.max(0, file_entry.sort_index),
      item_count: file_items.length,
    };
  }

  /**
   * 项目进度统计只基于 item status，任务运行态进度由 BatchTranslationSnapshot 单独提供。
   */
  private build_item_stats(items: ProjectItemPublicRecord[]): ProjectTranslationStats {
    let completed_count = 0;
    let failed_count = 0;
    let skipped_count = 0;
    for (const item of items) {
      const status = String(item["status"] ?? "NONE");
      if (COMPLETED_STATUSES.has(status)) {
        completed_count += 1;
      } else if (FAILED_STATUSES.has(status)) {
        failed_count += 1;
      } else if (SKIPPED_STATUSES.has(status)) {
        skipped_count += 1;
      }
    }
    const total_items = items.length;
    const pending_count = total_items - completed_count - failed_count - skipped_count;
    return {
      total_items,
      completed_count,
      failed_count,
      pending_count,
      skipped_count,
      // 跳过项视作已处理，沿用工作台的整数完成率。
      completion_percent:
        total_items === 0 ? 0 : Math.round(((completed_count + skipped_count) / total_items) * 100),
    };
  }
}
