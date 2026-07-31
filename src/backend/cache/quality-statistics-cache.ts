import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import * as AppErrors from "../../shared/error";
import type { QualityStatisticsRuleMode } from "../../shared/quality/quality-statistics";
import {
  prepare_quality_statistics_task_input,
  type QualityStatisticsPreparedTaskInput,
} from "../../shared/quality/quality-statistics-input";
import { resolve_quality_statistics_item_text_change_scope } from "../../shared/quality/quality-statistics-invalidation";
import type { ProjectDataSectionRevisions } from "../../shared/project-event";
import type { CacheChange } from "./cache-change";
import type { CacheReadPort } from "./cache-types";
import { is_json_record, read_json_record } from "../../domain/json";

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
  private readonly cache_reader: CacheReadPort; // 统计输入全部来自 session 缓存快照。
  private readonly worker_client: ComputeWorkerClient; // 计算密集逻辑交给 worker 执行。
  private readonly values = new Map<
    QualityStatisticsRuleMode,
    Map<string, Promise<Record<string, unknown>>>
  >();

  /**
   * 注入缓存读取端口和 worker client，保持统计缓存无数据库写入口。
   */
  public constructor(options: { cache: CacheReadPort; workerClient: ComputeWorkerClient }) {
    this.cache_reader = options.cache;
    this.worker_client = options.workerClient;
  }

  /**
   * 读取指定质量规则统计；未命中时启动一次 worker 计算。
   */
  public async read(rule_key: QualityStatisticsRuleMode): Promise<QualityStatisticsCacheResult> {
    const section_revisions = this.cache_reader.readSectionRevisions();
    const snapshot = this.cache_reader.snapshot();
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
    const statistics = await this.read_or_compute(rule_key, cache_key, prepared_input);
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
  private read_or_compute(
    rule_key: QualityStatisticsRuleMode,
    cache_key: string,
    prepared_input: QualityStatisticsPreparedTaskInput,
  ): Promise<Record<string, unknown>> {
    const cache_by_rule = this.read_cache_for_rule(rule_key);
    const cached = cache_by_rule.get(cache_key);
    if (cached !== undefined) {
      return cached;
    }

    const promise = this.worker_client
      .run(
        {
          type: "quality_statistics",
          input: prepared_input,
        },
        new AbortController().signal,
      )
      .catch((error: unknown) => {
        if (cache_by_rule.get(cache_key) === promise) {
          cache_by_rule.delete(cache_key);
        }
        throw error;
      });
    cache_by_rule.set(cache_key, promise);
    return promise;
  }

  /**
   * 每条规则独占一个 Promise 分桶，同时复用完成结果和进行中的请求。
   */
  private read_cache_for_rule(
    rule_key: QualityStatisticsRuleMode,
  ): Map<string, Promise<Record<string, unknown>>> {
    let cache_by_rule = this.values.get(rule_key);
    if (cache_by_rule === undefined) {
      cache_by_rule = new Map();
      this.values.set(rule_key, cache_by_rule);
    }
    return cache_by_rule;
  }

  /**
   * 从质量规则和 item 快照构造 prepared input，worker 不再读取 raw 项目事实。
   */
  private prepare_task_input(
    rule_key: QualityStatisticsRuleMode,
  ): QualityStatisticsPreparedTaskInput {
    const quality_block = this.cache_reader.quality.readBlock();
    const slice = read_json_record(quality_block[rule_key]);
    const entries = Array.isArray(slice["entries"])
      ? slice["entries"].flatMap((entry) => {
          return is_json_record(entry) ? [{ ...entry }] : [];
        })
      : [];
    return prepare_quality_statistics_task_input({
      rule_key,
      entries,
      items: this.cache_reader.items.readItems(),
    });
  }

  /**
   * 清理单个规则的结果和进行中请求。
   */
  private clear_rule(rule_key: QualityStatisticsRuleMode): void {
    this.values.delete(rule_key);
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
