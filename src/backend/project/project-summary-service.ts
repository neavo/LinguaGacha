import type { ProjectItemPublicRecord } from "../../domain/item";
import type { JsonValue, MutableJsonRecord } from "../../domain/json";
import type { CacheFileEntry, CacheReadPort } from "../cache/cache-types";
import { is_json_record } from "../../domain/json";
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
    const analysis_stats = this.build_analysis_stats(items, this.cache.analysis.readBlock());
    return {
      projectPath: project_path,
      sectionRevisions: this.cache.readSectionRevisions() as unknown as JsonValue,
      snapshot: {
        file_count: file_entries.length,
        total_items: items.length,
        translation_stats: stats,
        analysis_stats,
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
   * 项目进度统计只基于 item status，任务运行态进度由 TaskSnapshot 单独提供。
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
   * 分析统计优先消费任务写入的 status_summary，缺失时按可分析 item 数生成待处理态。
   */
  private build_analysis_stats(
    items: ProjectItemPublicRecord[],
    analysis_block: MutableJsonRecord,
  ): MutableJsonRecord {
    const status_summary = analysis_block["status_summary"];
    if (this.has_explicit_analysis_summary(analysis_block) && is_json_record(status_summary)) {
      const total_line = this.clamp_count(status_summary["total_line"], 0, items.length);
      const completed_count = this.clamp_count(status_summary["processed_line"], 0, total_line);
      const failed_count = this.clamp_count(
        status_summary["error_line"],
        0,
        Math.max(0, total_line - completed_count),
      );
      const pending_count = Math.max(0, total_line - completed_count - failed_count);
      return this.build_stats_result({
        total_items: items.length,
        completed_count,
        failed_count,
        pending_count,
        skipped_count: Math.max(0, items.length - total_line),
      });
    }

    let total_line = 0;
    for (const item of items) {
      const src = String(item["src"] ?? "").trim();
      const status = String(item["status"] ?? "NONE");
      if (src === "" || SKIPPED_STATUSES.has(status)) {
        continue;
      }
      total_line += 1;
    }
    return this.build_stats_result({
      total_items: items.length,
      completed_count: 0,
      failed_count: 0,
      pending_count: total_line,
      skipped_count: Math.max(0, items.length - total_line),
    });
  }

  /**
   * 旧工程可能缺少 analysis_extras，数据读取层补出的零值 summary 不能当成真实分析进度。
   */
  private has_explicit_analysis_summary(analysis_block: MutableJsonRecord): boolean {
    const extras = analysis_block["extras"];
    return is_json_record(extras) && Object.hasOwn(extras, "total_line");
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

  /**
   * 统计 summary 只接受有限整数，并限制到调用方给定范围内。
   */
  private clamp_count(value: unknown, min_value: number, max_value: number): number {
    return Math.min(max_value, Math.max(min_value, this.read_number(value as JsonValue, 0)));
  }
}
