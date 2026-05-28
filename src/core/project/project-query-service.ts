import type { ApiJsonValue } from "../api/api-types";
import type {
  AppSessionCache,
  AppSessionCachedFileEntry,
  AppSessionCachedItem,
} from "../app/app-session-cache";
import type { ProjectSessionState } from "./project-session-state";
import {
  prepare_analysis_glossary_import_from_cache,
  to_analysis_glossary_import_prepare_payload,
} from "./analysis-glossary-import-preparer";
import * as AppErrors from "../../shared/error";

type MutableJsonRecord = Record<string, ApiJsonValue>;

const COMPLETED_STATUSES = new Set(["PROCESSED"]);
const FAILED_STATUSES = new Set(["ERROR"]);
const SKIPPED_STATUSES = new Set(["EXCLUDED", "RULE_SKIPPED", "LANGUAGE_SKIPPED", "DUPLICATED"]);

/**
 * 后端 query service 从 AppSessionCache 读取热数据，并返回页面级 view model。
 */
export class ProjectQueryService {
  private readonly session_state: ProjectSessionState;
  private readonly app_session_cache: AppSessionCache;

  /**
   * session_state 提供工程身份，app_session_cache 提供当前项目热读事实。
   */
  public constructor(session_state: ProjectSessionState, app_session_cache: AppSessionCache) {
    this.session_state = session_state;
    this.app_session_cache = app_session_cache;
  }

  /**
   * 工作台 view 只返回文件列表和统计摘要，页面不再接收完整项目 section。
   */
  public read_workbench_view(): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const items = this.app_session_cache.readItems();
    const file_entries = this.build_file_entries(items, this.app_session_cache.readFileEntries());
    const stats = this.build_item_stats(items);
    const analysis_stats = this.build_analysis_stats(
      items,
      this.app_session_cache.readAnalysisBlock(),
    );
    return {
      projectPath: project_path,
      sectionRevisions: this.app_session_cache.readSectionRevisions() as unknown as ApiJsonValue,
      view: {
        file_count: file_entries.length,
        total_items: items.length,
        translation_stats: stats,
        analysis_stats,
        entries: file_entries as unknown as ApiJsonValue,
      },
    };
  }

  /**
   * 校对 query 支持运行态全量 hydrate、按 row id 回读和窗口化列表三种读取模式。
   */
  public read_proofreading_view(request: Record<string, ApiJsonValue>): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    if (request["runtime_snapshot"] === true) {
      const items = this.app_session_cache.readItems();
      return {
        projectPath: project_path,
        sectionRevisions: this.app_session_cache.readSectionRevisions() as unknown as ApiJsonValue,
        runtimeSnapshot: {
          items: items as unknown as ApiJsonValue,
          quality: this.app_session_cache.readQualityBlock() as unknown as ApiJsonValue,
          total_item_count: items.length,
        },
      };
    }

    const requested_row_ids = this.read_string_array(request["row_ids"]);
    if (requested_row_ids.length > 0) {
      const requested_item_ids = new Set(
        requested_row_ids
          .map((row_id) => Number(row_id))
          .filter((item_id) => Number.isInteger(item_id) && item_id > 0),
      );
      const rows = this.app_session_cache
        .readItems()
        .filter((item) => requested_item_ids.has(this.read_number(item["item_id"], 0)))
        .map((item, index) => this.build_proofreading_row(item, index));
      return {
        projectPath: project_path,
        sectionRevisions: this.app_session_cache.readSectionRevisions() as unknown as ApiJsonValue,
        rows: rows as unknown as ApiJsonValue,
      };
    }

    const keyword = String(request["keyword"] ?? "")
      .trim()
      .toLocaleLowerCase();
    const scope = String(request["scope"] ?? "all");
    const window_start = this.read_number(request["window_start"], 0);
    const window_count = this.read_number(request["window_count"], 100);
    const matched_items = this.app_session_cache
      .readItems()
      .filter((item) => this.matches_keyword(item, keyword, scope));
    const window_items = matched_items.slice(window_start, window_start + window_count);
    return {
      projectPath: project_path,
      sectionRevisions: this.app_session_cache.readSectionRevisions() as unknown as ApiJsonValue,
      view: {
        row_count: matched_items.length,
        window_start,
        window_rows: window_items.map((item, index) =>
          this.build_proofreading_row(item, window_start + index),
        ) as unknown as ApiJsonValue,
      },
    };
  }

  /**
   * 质量统计 query 返回指定规则当前缓存结果，前端只负责展示和触发刷新。
   */
  public read_quality_statistics(request: Record<string, ApiJsonValue>): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const rule_key = String(request["rule_key"] ?? "");
    return {
      projectPath: project_path,
      sectionRevisions: this.app_session_cache.readSectionRevisions() as unknown as ApiJsonValue,
      statistics: this.app_session_cache.readQualityStatistics(rule_key),
    };
  }

  /**
   * 质量规则 query 只读取单个规则切片，避免页面为编辑一个规则加载全部项目事实。
   */
  public read_quality_rule_view(request: Record<string, ApiJsonValue>): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const rule_type = this.read_quality_rule_type(request["rule_type"]);
    const quality_block = this.app_session_cache.readQualityBlock();
    return {
      projectPath: project_path,
      sectionRevisions: this.app_session_cache.readSectionRevisions() as unknown as ApiJsonValue,
      qualityRule: this.normalize_record(quality_block[rule_type]) as unknown as ApiJsonValue,
    };
  }

  /**
   * 简繁转换需要 item 列表和文本保护规则，二者都来自后端当前缓存。
   */
  public read_ts_conversion_view(): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const quality_block = this.app_session_cache.readQualityBlock();
    return {
      projectPath: project_path,
      sectionRevisions: this.app_session_cache.readSectionRevisions() as unknown as ApiJsonValue,
      items: this.app_session_cache.readItems() as unknown as ApiJsonValue,
      textPreserve: this.normalize_record(
        quality_block["text_preserve"],
      ) as unknown as ApiJsonValue,
    };
  }

  /**
   * 姓名字段提取只依赖 item 列表和术语表规则。
   */
  public read_name_field_extraction_view(): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const quality_block = this.app_session_cache.readQualityBlock();
    return {
      projectPath: project_path,
      sectionRevisions: this.app_session_cache.readSectionRevisions() as unknown as ApiJsonValue,
      items: this.app_session_cache.readItems() as unknown as ApiJsonValue,
      glossary: this.normalize_record(quality_block["glossary"]) as unknown as ApiJsonValue,
    };
  }

  /**
   * 自定义提示词页一次只读取当前任务类型对应的 prompt 切片。
   */
  public read_prompt_view(request: Record<string, ApiJsonValue>): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const task_type = this.read_prompt_task_type(request["task_type"]);
    const prompts_block = this.app_session_cache.readPromptsBlock();
    return {
      projectPath: project_path,
      sectionRevisions: this.app_session_cache.readSectionRevisions() as unknown as ApiJsonValue,
      prompt: this.normalize_record(prompts_block[task_type]) as unknown as ApiJsonValue,
    };
  }

  /**
   * 分析术语导入准备在后端组合候选聚合、质量规则和当前 item，保证导入计划不依赖页面缓存。
   */
  public prepare_analysis_glossary_import(
    request: Record<string, ApiJsonValue>,
  ): MutableJsonRecord {
    const project_path = this.require_loaded_project_path();
    const action = this.read_quality_import_action(request["action"]);
    const section_revisions = this.app_session_cache.readSectionRevisions();
    const prepared_import = prepare_analysis_glossary_import_from_cache({
      quality_block: this.app_session_cache.readQualityBlock(),
      items: this.app_session_cache.readItems(),
      section_revisions,
      candidate_aggregate: this.read_record(request["candidate_aggregate"]),
      action,
    });
    return {
      projectPath: project_path,
      sectionRevisions: section_revisions as unknown as ApiJsonValue,
      prepared_import: to_analysis_glossary_import_prepare_payload(prepared_import),
    };
  }

  /**
   * 按文件路径聚合工作台列表，统计结果和文件条目使用同一批 item。
   */
  private build_file_entries(
    items: AppSessionCachedItem[],
    cached_file_entries: AppSessionCachedFileEntry[],
  ): MutableJsonRecord[] {
    const entries_by_path = new Map<string, AppSessionCachedItem[]>();
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
      result.push(this.build_workbench_file_entry(file_entry, file_items, result.length));
    }
    for (const [rel_path, file_items] of entries_by_path.entries()) {
      if (emitted_paths.has(rel_path)) {
        continue;
      }
      result.push(
        this.build_workbench_file_entry(
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
   * 工作台文件行同时携带 asset 顺序和该文件下 item 统计。
   */
  private build_workbench_file_entry(
    file_entry: AppSessionCachedFileEntry,
    file_items: AppSessionCachedItem[],
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
   * 工作台进度统计只基于 item status，任务运行态进度由 TaskSnapshot 单独提供。
   */
  private build_item_stats(items: AppSessionCachedItem[]): MutableJsonRecord {
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
    items: AppSessionCachedItem[],
    analysis_block: MutableJsonRecord,
  ): MutableJsonRecord {
    const status_summary = analysis_block["status_summary"];
    if (this.has_explicit_analysis_summary(analysis_block) && this.is_record(status_summary)) {
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
   * 旧工程可能缺少 analysis_extras，投影层补出的零值 summary 不能当成真实分析进度。
   */
  private has_explicit_analysis_summary(analysis_block: MutableJsonRecord): boolean {
    const extras = analysis_block["extras"];
    return this.is_record(extras) && Object.hasOwn(extras, "total_line");
  }

  /**
   * 工作台完成率沿用跳过项视作已处理的口径。
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
   * 校对行保持 row_id 和 item 原始记录绑定，页面窗口滚动只依赖 row_id。
   */
  private build_proofreading_row(item: AppSessionCachedItem, index: number): MutableJsonRecord {
    return {
      row_id: String(item["item_id"] ?? index),
      item,
      warnings: [],
      warning_fragments_by_code: {},
      applied_terms: [],
      failed_terms: [],
    };
  }

  /**
   * 关键字过滤在后端 query 侧执行，避免 renderer 为搜索复制完整 item 缓存。
   */
  private matches_keyword(item: AppSessionCachedItem, keyword: string, scope: string): boolean {
    if (keyword === "") {
      return true;
    }
    const src = String(item["src"] ?? "").toLocaleLowerCase();
    const dst = String(item["dst"] ?? "").toLocaleLowerCase();
    if (scope === "src") {
      return src.includes(keyword);
    }
    if (scope === "dst") {
      return dst.includes(keyword);
    }
    return src.includes(keyword) || dst.includes(keyword);
  }

  /**
   * 所有 query 都必须绑定当前 loaded 工程，未加载时返回统一业务错误。
   */
  private require_loaded_project_path(): string {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new AppErrors.ProjectNotLoadedError();
    }
    return state.projectPath;
  }

  /**
   * query 参数里的数值统一非负截断，窗口参数不能传入负索引。
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
  }

  /**
   * 外部请求里的对象参数进入领域逻辑前先收窄成普通记录。
   */
  private read_record(value: ApiJsonValue | undefined): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  /**
   * row id 请求只接受数组语义，其它输入按空集合处理。
   */
  private read_string_array(value: ApiJsonValue | undefined): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((entry) => String(entry));
  }

  /**
   * 缺失或非法规则切片按空记录返回，页面由默认值补齐 UI 状态。
   */
  private normalize_record(value: unknown): MutableJsonRecord {
    if (!this.is_record(value)) {
      return {};
    }
    return value as MutableJsonRecord;
  }

  /**
   * 统计 summary 只接受有限整数，并限制到调用方给定范围内。
   */
  private clamp_count(value: unknown, min_value: number, max_value: number): number {
    return Math.min(max_value, Math.max(min_value, this.read_number(value as ApiJsonValue, 0)));
  }

  /**
   * 收窄 query 内部 JSON record，避免 summary 读取把数组当对象。
   */
  private is_record(value: unknown): value is MutableJsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * 质量规则 query 的 rule_type 必须是公开规则类型，不能透传物理目录名。
   */
  private read_quality_rule_type(
    value: ApiJsonValue | undefined,
  ): "glossary" | "pre_replacement" | "post_replacement" | "text_preserve" {
    if (
      value === "glossary" ||
      value === "pre_replacement" ||
      value === "post_replacement" ||
      value === "text_preserve"
    ) {
      return value;
    }
    throw new AppErrors.RequestValidationError({
      diagnostic_context: { reason: "invalid_quality_rule_type" },
    });
  }

  /**
   * 分析术语导入动作只允许 skip / overwrite，默认 overwrite 对齐历史导入行为。
   */
  private read_quality_import_action(value: ApiJsonValue | undefined): "skip" | "overwrite" {
    if (value === undefined || value === null || value === "overwrite") {
      return "overwrite";
    }
    if (value === "skip") {
      return "skip";
    }
    throw new AppErrors.RequestValidationError({
      diagnostic_context: { reason: "invalid_analysis_glossary_import_action" },
    });
  }

  /**
   * prompt query 只暴露翻译和分析两类任务提示词。
   */
  private read_prompt_task_type(value: ApiJsonValue | undefined): "translation" | "analysis" {
    if (value === "translation" || value === "analysis") {
      return value;
    }
    throw new AppErrors.RequestValidationError({
      diagnostic_context: { reason: "invalid_prompt_task_type" },
    });
  }
}
