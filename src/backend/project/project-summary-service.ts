import type { ProjectItemPublicRecord } from "../../domain/item";
import type { JsonValue, MutableJsonRecord } from "../../domain/json";
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
  public constructor(session_state: ProjectSessionState, cache: CacheReadPort) {
    this.session_state = session_state;
    this.cache = cache;
  }

  /**
   * 项目摘要只返回文件列表和统计结果，页面不再接收完整项目区块。
   */
  public read(): MutableJsonRecord {
    const project_path = this.session_state.require_loaded_project_path();
    const items = this.cache.items.readItems();
    const file_entries = this.build_file_entries(items, this.cache.files.readFileEntries());
    const stats = this.build_item_stats(items);
    return {
      projectPath: project_path,
      sectionRevisions: this.cache.readSectionRevisions() as unknown as JsonValue,
      snapshot: {
        file_count: file_entries.length,
        total_items: items.length,
        translation_stats: stats,
        entries: file_entries as unknown as JsonValue,
      },
    };
  }

  /**
   * 按文件路径聚合项目列表，统计结果和文件条目使用同一批 item。
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
      if (rel_path === "") {
        continue;
      }
      const file_items = entries_by_path.get(rel_path) ?? [];
      emitted_paths.add(rel_path);
      result.push(this.build_project_file_entry(file_entry, file_items, result.length));
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
          result.length,
        ),
      );
    }
    return result;
  }

  /**
   * 项目文件行同时携带 asset 顺序和该文件下 item 统计。
   */
  private build_project_file_entry(
    file_entry: CacheFileEntry,
    file_items: ProjectItemPublicRecord[],
    fallback_sort_index: number,
  ): MutableJsonRecord {
    return {
      rel_path: file_entry.rel_path,
      file_type: file_entry.file_type,
      sort_index: this.read_number(file_entry.sort_index, fallback_sort_index),
      item_count: file_items.length,
    };
  }

  /**
   * 项目进度统计只基于 item status，任务运行态进度由 BatchTranslationSnapshot 单独提供。
   */
  private build_item_stats(items: ProjectItemPublicRecord[]): MutableJsonRecord {
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
    const pending_count = Math.max(0, total_items - completed_count - failed_count - skipped_count);
    return this.build_stats_result({
      total_items,
      completed_count,
      failed_count,
      pending_count,
      skipped_count,
    });
  }

  /**
   * 项目完成率沿用跳过项视作已处理的口径。
   */
  private build_stats_result(args: {
    total_items: number;
    completed_count: number;
    failed_count: number;
    pending_count: number;
    skipped_count: number;
  }): MutableJsonRecord {
    const completed_or_skipped_count = args.completed_count + args.skipped_count;
    return {
      total_items: args.total_items,
      completed_count: args.completed_count,
      failed_count: args.failed_count,
      pending_count: args.pending_count,
      skipped_count: args.skipped_count,
      completion_percent:
        args.total_items === 0
          ? 0
          : Math.round((completed_or_skipped_count / args.total_items) * 100),
    };
  }

  /**
   * query 参数里的数值统一非负截断，窗口参数不能传入负索引。
   */
  private read_number(value: JsonValue | undefined, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
  }
}
