import type { ApiJsonValue } from "../api/api-types";
import type { ProjectDatabase } from "../database/database-operations";
import type { LogManager } from "../log/log-manager";
import {
  ProjectRuntimeProjectionService,
  type ProjectRuntimeProjectionMutableRecord,
} from "../project/project-runtime-projection-service";
import type { AppEvent } from "./app-events";
import type { ProjectDataSectionRevisions } from "../../shared/project-event";
import {
  run_quality_statistics_task_sync,
  type QualityStatisticsDependencySnapshot,
  type QualityStatisticsRelationCandidate,
  type QualityStatisticsRuleInput,
  type QualityStatisticsRuleMode,
} from "../../shared/quality/quality-statistics";

const QUALITY_STATISTICS_RULE_KEYS = [
  "glossary",
  "pre_replacement",
  "post_replacement",
  "text_preserve",
] as const satisfies readonly QualityStatisticsRuleMode[];

// AppSessionCacheFreshness 描述当前热读缓存是否可直接服务 query。
export type AppSessionCacheFreshness = "empty" | "fresh" | "stale" | "recoverable_error";

// AppSessionCacheSnapshot 是诊断和测试读取缓存状态的最小公开形状。
export type AppSessionCacheSnapshot = {
  projectPath: string;
  epoch: number;
  freshness: AppSessionCacheFreshness;
  sectionRevisions: ProjectDataSectionRevisions;
  itemCount: number;
};

// AppSessionCachedItem 保持和运行态投影一致，query service 只读克隆后的记录。
export type AppSessionCachedItem = ProjectRuntimeProjectionMutableRecord;

export type AppSessionCachedFileEntry = {
  rel_path: string;
  file_type: string;
  sort_index: number;
};

// AppSessionCache 是当前 loaded 工程的唯一热读缓存，所有页面 query 都从这里读取项目事实。
export class AppSessionCache {
  private readonly database: ProjectDatabase;
  private readonly projection_service: ProjectRuntimeProjectionService;
  private readonly log_manager: Pick<LogManager, "warning" | "error"> | null;
  private project_path = "";
  private epoch = 0;
  private freshness: AppSessionCacheFreshness = "empty";
  private items_by_id = new Map<number, AppSessionCachedItem>();
  private item_order: number[] = [];
  private file_index = new Map<string, number[]>();
  private file_entries: AppSessionCachedFileEntry[] = [];
  private quality_block: ProjectRuntimeProjectionMutableRecord = {};
  private quality_statistics_by_rule: ProjectRuntimeProjectionMutableRecord = {};
  private prompts_block: ProjectRuntimeProjectionMutableRecord = {};
  private analysis_block: ProjectRuntimeProjectionMutableRecord = {};
  private section_revisions: ProjectDataSectionRevisions = {};
  private recoverable_error: unknown = null;

  /**
   * database 是事实源，log_manager 只记录缓存维护失败，不参与恢复判断。
   */
  public constructor(
    database: ProjectDatabase,
    log_manager: Pick<LogManager, "warning" | "error"> | null = null,
  ) {
    this.database = database;
    this.projection_service = new ProjectRuntimeProjectionService(database);
    this.log_manager = log_manager;
  }

  /**
   * 工程加载只在完整重建成功后进入 fresh，保证 loaded 身份和缓存内容同步成立。
   */
  public async warmProject(project_path: string): Promise<void> {
    this.rebuild_project(project_path);
  }

  /**
   * 清理指定工程缓存；迟到的旧工程 unload 不能清掉新工程热缓存。
   */
  public clearProject(project_path?: string): void {
    if (
      project_path !== undefined &&
      this.project_path !== "" &&
      this.project_path !== project_path
    ) {
      return;
    }
    this.project_path = "";
    this.epoch += 1;
    this.freshness = "empty";
    this.items_by_id = new Map();
    this.item_order = [];
    this.file_index = new Map();
    this.file_entries = [];
    this.quality_block = {};
    this.quality_statistics_by_rule = {};
    this.prompts_block = {};
    this.analysis_block = {};
    this.section_revisions = {};
    this.recoverable_error = null;
  }

  /**
   * committed event 只驱动当前工程缓存重建；其它工程事件被身份闸门丢弃。
   */
  public async handleAppEvent(event: AppEvent): Promise<void> {
    if (event.type === "project.opened_for_cache") {
      await this.warmProject(event.projectPath);
      return;
    }
    if (event.type === "project.unloaded") {
      this.clearProject(event.projectPath);
      return;
    }
    if (event.projectPath !== this.project_path) {
      return;
    }
    try {
      this.rebuild_project(event.projectPath);
    } catch (error) {
      this.mark_recoverable_error(error, event);
    }
  }

  /**
   * 读取 item 列表时返回克隆记录，避免 query consumer 修改缓存内部对象。
   */
  public readItems(query: { filePath?: string } = {}): AppSessionCachedItem[] {
    this.recover_if_needed();
    const ids =
      query.filePath === undefined ? this.item_order : (this.file_index.get(query.filePath) ?? []);
    return ids
      .map((item_id) => this.items_by_id.get(item_id))
      .filter((item): item is AppSessionCachedItem => item !== undefined)
      .map((item) => ({ ...item }));
  }

  /**
   * 按 item id 精确读取当前缓存记录，供页面 query 做小范围回读。
   */
  public readItem(item_id: number): AppSessionCachedItem | null {
    this.recover_if_needed();
    const item = this.items_by_id.get(item_id);
    return item === undefined ? null : { ...item };
  }

  /**
   * 文件列表顺序来自 asset sort_order，工作台 query 不能从 item 顺序重新推断。
   */
  public readFileEntries(): AppSessionCachedFileEntry[] {
    this.recover_if_needed();
    return this.file_entries.map((entry) => ({ ...entry }));
  }

  /**
   * 质量检查结果当前由 query 协议保留占位，后续只能从缓存事实补齐。
   */
  public readQualityCheck(item_id: number): ProjectRuntimeProjectionMutableRecord {
    this.recover_if_needed();
    return {
      item_id,
      warnings: [],
      warning_fragments_by_code: {},
    };
  }

  /**
   * 质量统计读取已经完成的后端缓存结果，前端不再自行维护第二套统计事实。
   */
  public readQualityStatistics(rule_key: string): ApiJsonValue {
    this.recover_if_needed();
    return this.quality_statistics_by_rule[rule_key] ?? null;
  }

  /**
   * 质量规则块按公开投影返回浅克隆，调用方不得改写缓存事实。
   */
  public readQualityBlock(): ProjectRuntimeProjectionMutableRecord {
    this.recover_if_needed();
    return { ...this.quality_block };
  }

  /**
   * 提示词块按公开投影返回浅克隆，供 query service 组合页面 view。
   */
  public readPromptsBlock(): ProjectRuntimeProjectionMutableRecord {
    this.recover_if_needed();
    return { ...this.prompts_block };
  }

  /**
   * 分析轻量状态来自 meta 投影，工作台 query 用它还原分析任务统计。
   */
  public readAnalysisBlock(): ProjectRuntimeProjectionMutableRecord {
    this.recover_if_needed();
    return { ...this.analysis_block };
  }

  /**
   * section revision 是 renderer mutation 乐观锁唯一来源。
   */
  public readSectionRevisions(): ProjectDataSectionRevisions {
    this.recover_if_needed();
    return { ...this.section_revisions };
  }

  /**
   * 快照只暴露缓存身份和计数，不泄露项目内容。
   */
  public snapshot(): AppSessionCacheSnapshot {
    return {
      projectPath: this.project_path,
      epoch: this.epoch,
      freshness: this.freshness,
      sectionRevisions: { ...this.section_revisions },
      itemCount: this.items_by_id.size,
    };
  }

  /**
   * 从数据库投影一次性重建全部索引，避免局部增量失败留下半更新缓存。
   */
  private rebuild_project(project_path: string): void {
    const meta = this.projection_service.get_all_meta(project_path);
    const items_snapshot = this.projection_service.build_runtime_items_snapshot(project_path);
    const next_items_by_id = new Map<number, AppSessionCachedItem>();
    const next_item_order: number[] = [];
    const next_file_index = new Map<string, number[]>();
    for (const item of items_snapshot.item_records) {
      const item_id = this.read_number(item["item_id"], 0);
      if (item_id <= 0) {
        continue;
      }
      next_items_by_id.set(item_id, { ...item });
      next_item_order.push(item_id);
      const file_path = String(item["file_path"] ?? "");
      if (file_path !== "") {
        const ids = next_file_index.get(file_path) ?? [];
        ids.push(item_id);
        next_file_index.set(file_path, ids);
      }
    }
    this.project_path = project_path;
    this.epoch += 1;
    this.items_by_id = next_items_by_id;
    this.item_order = next_item_order;
    this.file_index = next_file_index;
    this.file_entries = this.normalize_file_entries(
      this.projection_service.build_files_record_block(project_path, items_snapshot),
    );
    this.quality_block = this.projection_service.build_quality_block(project_path, meta);
    this.quality_statistics_by_rule = this.build_quality_statistics_by_rule(
      this.quality_block,
      next_item_order
        .map((item_id) => next_items_by_id.get(item_id))
        .filter((item): item is AppSessionCachedItem => item !== undefined),
    );
    this.prompts_block = this.projection_service.build_prompts_block(project_path, meta);
    this.analysis_block = this.projection_service.build_analysis_block(meta);
    this.section_revisions = this.projection_service.build_section_revisions(meta);
    this.freshness = "fresh";
    this.recoverable_error = null;
  }

  /**
   * 读取前尝试从 recoverable_error 恢复，保证暂时失败的 after-commit 不永久污染 query。
   */
  private recover_if_needed(): void {
    if (this.freshness !== "stale" && this.freshness !== "recoverable_error") {
      return;
    }
    if (this.project_path === "") {
      return;
    }
    this.rebuild_project(this.project_path);
  }

  /**
   * 缓存维护失败只降级为可恢复状态，真实错误保留到日志诊断。
   */
  private mark_recoverable_error(error: unknown, event: AppEvent): void {
    this.freshness = "recoverable_error";
    this.recoverable_error = error;
    this.log_manager?.warning("AppSessionCache 缓存维护失败，后续读取将尝试恢复。", {
      source: "app-session-cache",
      context: {
        event_type: event.type,
        project_path: event.projectPath,
      },
    });
  }

  /**
   * 在后端热缓存里预计算质量统计，让质量页读取到和当前 items 对齐的结果。
   */
  private build_quality_statistics_by_rule(
    quality_block: ProjectRuntimeProjectionMutableRecord,
    items: AppSessionCachedItem[],
  ): ProjectRuntimeProjectionMutableRecord {
    const result: ProjectRuntimeProjectionMutableRecord = {};
    const src_texts = items.map((item) => String(item["src"] ?? ""));
    const dst_texts = items.map((item) => String(item["dst"] ?? ""));
    for (const rule_key of QUALITY_STATISTICS_RULE_KEYS) {
      const slice = this.normalize_record(quality_block[rule_key]);
      const entries = Array.isArray(slice["entries"]) ? slice["entries"] : [];
      const rules = this.build_quality_statistics_rules(rule_key, entries);
      const relation_candidates = this.build_quality_relation_candidates(rules);
      const statistics_result = run_quality_statistics_task_sync({
        rules,
        srcTexts: src_texts,
        dstTexts: dst_texts,
        relationCandidates: relation_candidates,
      });
      const completed_entry_ids = rules.map((rule) => rule.key);
      const matched_count_by_entry_id = Object.fromEntries(
        completed_entry_ids.map((entry_id) => {
          return [entry_id, statistics_result.results[entry_id]?.matched_item_count ?? 0];
        }),
      );
      const subset_parent_labels_by_entry_id = Object.fromEntries(
        completed_entry_ids.map((entry_id) => {
          return [entry_id, statistics_result.results[entry_id]?.subset_parents ?? []];
        }),
      );
      const completed_snapshot = this.build_quality_statistics_dependency_snapshot(
        rule_key,
        rules,
        rule_key === "post_replacement" ? dst_texts : src_texts,
      );
      result[rule_key] = {
        phase: "current",
        current_snapshot: completed_snapshot,
        completed_snapshot,
        completed_entry_ids,
        matched_count_by_entry_id,
        subset_parent_labels_by_entry_id,
        last_error: null,
        request_token: 0,
        updated_at: Date.now(),
      };
    }
    return result;
  }

  /**
   * 将质量规则投影转成共享统计任务输入，空规则不会进入统计集合。
   */
  private build_quality_statistics_rules(
    rule_key: QualityStatisticsRuleMode,
    entries: unknown[],
  ): QualityStatisticsRuleInput[] {
    return entries.flatMap((entry, index) => {
      if (!this.is_record(entry)) {
        return [];
      }
      const pattern = String(entry["src"] ?? "");
      if (pattern.trim() === "") {
        return [];
      }
      return [
        {
          key: this.build_quality_entry_id(entry, index),
          pattern,
          mode: rule_key,
          regex: rule_key === "text_preserve" ? true : Boolean(entry["regex"]),
          case_sensitive: Boolean(entry["case_sensitive"]),
        },
      ];
    });
  }

  /**
   * 子集关系统计只需要规则 key 和原始 pattern，避免把完整规则对象传入共享算法。
   */
  private build_quality_relation_candidates(
    rules: QualityStatisticsRuleInput[],
  ): QualityStatisticsRelationCandidate[] {
    return rules.map((rule) => {
      return {
        key: rule.key,
        src: rule.pattern,
      };
    });
  }

  /**
   * dependency snapshot 表达统计结果依赖的文本与规则签名，供前端判断缓存是否当前有效。
   */
  private build_quality_statistics_dependency_snapshot(
    rule_key: QualityStatisticsRuleMode,
    rules: QualityStatisticsRuleInput[],
    texts: string[],
  ): QualityStatisticsDependencySnapshot {
    const text_signature = this.build_quality_text_signature(texts);
    const snapshot_rules = rules.map((rule) => {
      const dependency_signature = JSON.stringify([
        rule.mode,
        rule.pattern,
        Boolean(rule.regex),
        Boolean(rule.case_sensitive),
      ]);
      return {
        key: rule.key,
        dependency_signature,
        relation_label: rule.pattern,
        token: `${dependency_signature}:${rule.key}`,
      };
    });
    const dependency_signature = JSON.stringify({
      text_source: rule_key === "post_replacement" ? "dst" : "src",
      text_signature,
      tokens: snapshot_rules.map((rule) => rule.token),
    });

    return {
      text_source: rule_key === "post_replacement" ? "dst" : "src",
      text_signature,
      dependency_signature,
      snapshot_signature: JSON.stringify({
        dependency_signature,
        keys: snapshot_rules.map((rule) => rule.key),
      }),
      rules: snapshot_rules,
    };
  }

  /**
   * 文本签名使用带 index 和 length 的 framed text，避免简单拼接造成边界碰撞。
   */
  private build_quality_text_signature(texts: string[]): string {
    let hash = 2166136261;
    for (const [index, text] of texts.entries()) {
      const framed_text = `${index.toString()}:${text.length.toString()}:${text}`;
      for (let char_index = 0; char_index < framed_text.length; char_index += 1) {
        hash ^= framed_text.charCodeAt(char_index);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
    }
    return `${texts.length.toString()}:${hash.toString(36)}`;
  }

  /**
   * 质量规则缺少稳定 entry_id 时用 pattern 和顺序兜底，保证统计结果仍可回填。
   */
  private build_quality_entry_id(
    entry: ProjectRuntimeProjectionMutableRecord,
    index: number,
  ): string {
    const entry_id = String(entry["entry_id"] ?? "");
    if (entry_id !== "") {
      return entry_id;
    }
    return `${String(entry["src"] ?? "").trim()}::${index.toString()}`;
  }

  /**
   * 数据库 JSON 投影在进入缓存前统一收窄成可索引记录。
   */
  private normalize_record(value: unknown): ProjectRuntimeProjectionMutableRecord {
    return this.is_record(value) ? { ...value } : {};
  }

  /**
   * files section 按对象插入顺序承载 asset sort_order，这里收窄成显式数组供 query 使用。
   */
  private normalize_file_entries(
    files_block: ProjectRuntimeProjectionMutableRecord,
  ): AppSessionCachedFileEntry[] {
    return Object.values(files_block).flatMap((value, index) => {
      if (!this.is_record(value)) {
        return [];
      }
      const rel_path = String(value["rel_path"] ?? "").trim();
      if (rel_path === "") {
        return [];
      }
      return [
        {
          rel_path,
          file_type: String(value["file_type"] ?? "NONE"),
          sort_index: this.read_number(value["sort_index"], index),
        },
      ];
    });
  }

  /**
   * 只接受普通对象作为 JSON 记录，数组不能伪装成规则块。
   */
  private is_record(value: unknown): value is ProjectRuntimeProjectionMutableRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * 数字字段统一截断，避免小数或非法值进入 item id / revision 计算。
   */
  private read_number(value: unknown, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  }
}
