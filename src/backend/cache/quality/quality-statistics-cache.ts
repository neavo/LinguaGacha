import type { BackendWorkerClient } from "../../worker/worker-client";
import * as AppErrors from "../../../shared/error";
import type { QualityStatisticsRuleMode } from "../../../shared/quality/quality-statistics";
import {
  prepare_quality_statistics_task_input,
  type QualityStatisticsPreparedTaskInput,
} from "../../../shared/quality/quality-statistics-input";
import { resolve_quality_statistics_item_text_change_scope } from "../../../shared/quality/quality-statistics-invalidation";
import type { ProjectDataSectionRevisions } from "../../../shared/project-event";
import type { CacheChange } from "../cache-change";
import type { CacheReadPort } from "../cache-types";

/**
 * QualityStatisticsCacheResult 携带统计结果和读取时的项目 revision。
 */
export type QualityStatisticsCacheResult = {
  projectPath: string;
  sectionRevisions: ProjectDataSectionRevisions;
  statistics: Record<string, unknown>;
};

/**
 * QualityStatisticsCache 缓存质量规则统计结果，并合并同 key 并发计算。
 */
export class QualityStatisticsCache {
  private readonly cache: CacheReadPort; // 统计输入全部来自 session 缓存快照。
  private readonly worker_client: BackendWorkerClient; // 计算密集逻辑交给 worker 执行。
  // 已完成结果按规则类型分桶，便于译文变化只清理后置替换统计。
  private readonly values = new Map<
    QualityStatisticsRuleMode,
    Map<string, Record<string, unknown>>
  >();
  // 进行中的 worker promise 和完成缓存使用同一分桶，失效时可一起废弃。
  private readonly pending = new Map<
    QualityStatisticsRuleMode,
    Map<string, Promise<Record<string, unknown>>>
  >();

  /**
   * 注入缓存读取端口和 worker client，保持统计缓存无数据库写入口。
   */
  public constructor(options: { cache: CacheReadPort; workerClient: BackendWorkerClient }) {
    this.cache = options.cache;
    this.worker_client = options.workerClient;
  }

  /**
   * 读取指定质量规则统计；未命中时启动一次 worker 计算。
   */
  public async read(rule_key: QualityStatisticsRuleMode): Promise<QualityStatisticsCacheResult> {
    const section_revisions = this.cache.readSectionRevisions();
    const snapshot = this.cache.snapshot();
    if (snapshot.projectPath === "") {
      throw new AppErrors.ProjectNotLoadedError();
    }
    const prepared_input = this.prepare_task_input(rule_key);
    // cache key 使用实际依赖快照，避免 item revision 推进造成原文类规则无效重算。
    const cache_key = JSON.stringify({
      project_path: snapshot.projectPath,
      rule_key,
      snapshot_signature: prepared_input.completed_snapshot.snapshot_signature,
    });
    const cached = this.read_values_for_rule(rule_key).get(cache_key);
    if (cached !== undefined) {
      return {
        projectPath: snapshot.projectPath,
        sectionRevisions: section_revisions,
        statistics: cached,
      };
    }
    const statistics = await this.compute(rule_key, cache_key, prepared_input);
    return {
      projectPath: snapshot.projectPath,
      sectionRevisions: section_revisions,
      statistics,
    };
  }

  /**
   * 清空已完成结果和进行中的复用 promise。
   */
  public clear(): void {
    this.values.clear();
    this.pending.clear();
  }

  /**
   * 按项目变更的文本源影响清理统计缓存。
   */
  public applyChange(change: CacheChange): void {
    const scope = resolve_quality_statistics_cache_clear_scope(change);
    if (scope === "none") {
      return;
    }
    if (scope === "all") {
      this.clear();
      return;
    }
    this.clear_rule(scope);
  }

  /**
   * 从当前缓存快照构造 worker 输入并写回结果缓存。
   */
  private async compute(
    rule_key: QualityStatisticsRuleMode,
    cache_key: string,
    prepared_input: QualityStatisticsPreparedTaskInput,
  ): Promise<Record<string, unknown>> {
    const pending_by_rule = this.read_pending_for_rule(rule_key);
    const pending = pending_by_rule.get(cache_key);
    if (pending !== undefined) {
      return pending;
    }
    // pending 写入分桶后再等待 worker，后续同 key 请求会复用同一个计算。
    const promise = this.worker_client.run(
      {
        type: "quality_statistics",
        input: prepared_input,
      },
      new AbortController().signal,
    );
    pending_by_rule.set(cache_key, promise);
    try {
      const result = await promise;
      // 如果等待期间缓存已按变更失效，旧 promise 完成后不能重新污染结果缓存。
      if (this.read_pending_for_rule(rule_key).get(cache_key) === promise) {
        this.read_values_for_rule(rule_key).set(cache_key, result);
      }
      return result;
    } finally {
      const current_pending_by_rule = this.pending.get(rule_key);
      if (current_pending_by_rule?.get(cache_key) === promise) {
        current_pending_by_rule.delete(cache_key);
      }
    }
  }

  /**
   * 从质量规则和 item 快照构造 prepared input，worker 不再读取 raw 项目事实。
   */
  private prepare_task_input(
    rule_key: QualityStatisticsRuleMode,
  ): QualityStatisticsPreparedTaskInput {
    const quality_block = this.cache.quality.readBlock();
    const slice =
      typeof quality_block[rule_key] === "object" &&
      quality_block[rule_key] !== null &&
      !Array.isArray(quality_block[rule_key])
        ? (quality_block[rule_key] as Record<string, unknown>)
        : {};
    const entries = Array.isArray(slice["entries"])
      ? slice["entries"].flatMap((entry) => {
          return typeof entry === "object" && entry !== null && !Array.isArray(entry)
            ? [{ ...(entry as Record<string, unknown>) }]
            : [];
        })
      : [];
    return prepare_quality_statistics_task_input({
      rule_key,
      entries,
      items: this.cache.items.readItems(),
    });
  }

  /**
   * 读取或创建指定规则的完成结果分桶。
   */
  private read_values_for_rule(
    rule_key: QualityStatisticsRuleMode,
  ): Map<string, Record<string, unknown>> {
    const existing = this.values.get(rule_key);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Map<string, Record<string, unknown>>();
    this.values.set(rule_key, created);
    return created;
  }

  /**
   * 读取或创建指定规则的进行中请求分桶。
   */
  private read_pending_for_rule(
    rule_key: QualityStatisticsRuleMode,
  ): Map<string, Promise<Record<string, unknown>>> {
    const existing = this.pending.get(rule_key);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Map<string, Promise<Record<string, unknown>>>();
    this.pending.set(rule_key, created);
    return created;
  }

  /**
   * 清理单个规则的完成结果和进行中请求。
   */
  private clear_rule(rule_key: QualityStatisticsRuleMode): void {
    this.values.delete(rule_key);
    this.pending.delete(rule_key);
  }
}

/**
 * 将 CacheChange 归一为统计缓存清理范围，后端和前端共享同一文本源判定。
 */
function resolve_quality_statistics_cache_clear_scope(
  change: CacheChange,
): "none" | "post_replacement" | "all" {
  if (change.quality.mode === "full") {
    return "all";
  }
  if (change.items.mode === "keep") {
    return "none";
  }
  if (change.items.mode === "full") {
    return "all";
  }
  return resolve_quality_statistics_item_text_change_scope({
    source: change.source,
    fullReplace: false,
    deleteCount: change.items.deleteIds.length,
    fieldPatch: change.items.fieldPatch,
  });
}
