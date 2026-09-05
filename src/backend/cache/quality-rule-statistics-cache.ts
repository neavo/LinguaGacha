import type { QualityRuleKind } from "../../domain/quality";
import { prepare_quality_statistics_task_input } from "../../shared/quality/quality-statistics-input";
import { resolve_quality_statistics_item_text_change_scope } from "../../shared/quality/quality-statistics-invalidation";
import type { ProjectDataSectionRevisions } from "../../shared/project-event";
import type {
  QualityRuleStatisticsWorkerTaskInput,
  QualityRuleStatisticsWorkerTaskResult,
} from "../worker/tasks/quality-rule-statistics-worker-task";
import type { CacheChange } from "./cache-change";
import type { CacheReadPort } from "./cache-types";
import { read_json_record } from "../../domain/json";
import * as AppErrors from "../../shared/error";

export type QualityRuleStatistics = Omit<
  QualityRuleStatisticsWorkerTaskResult,
  "subset_parents_by_entry_id"
> & {
  subset_parents_by_entry_id: Record<string, string[]>;
};

export type QualityRuleStatisticsCacheResult = {
  projectPath: string;
  sectionRevisions: ProjectDataSectionRevisions;
  statistics: QualityRuleStatistics;
};

type QualityRuleStatisticsCacheEntry = {
  subsetParents: Record<string, string[]> | null; // item 变化时仍可复用的字面包含父项
  statistics: Promise<QualityRuleStatistics> | null; // 已完成结果与同 key 并发请求共用同一 Promise
};

type QualityRuleStatisticsCacheReadPort = Pick<
  CacheReadPort,
  "items" | "quality" | "readSectionRevisions" | "snapshot"
>;

type QualityRuleStatisticsWorkerClient = {
  /** 提交唯一受支持的质量统计任务，不暴露 worker 队列的其它能力。 */
  run(
    task: { type: "quality_rule_statistics"; input: QualityRuleStatisticsWorkerTaskInput },
    signal: AbortSignal,
  ): Promise<QualityRuleStatisticsWorkerTaskResult>;
};

/** 质量规则统计缓存以项目变更精准失效为准，命中时不读取或哈希全量 item。 */
export class QualityRuleStatisticsCache {
  private readonly cache_reader: QualityRuleStatisticsCacheReadPort; // 唯一规则与 item 快照来源
  private readonly worker_client: QualityRuleStatisticsWorkerClient; // 重型统计的无状态执行边界
  private readonly values = new Map<QualityRuleKind, QualityRuleStatisticsCacheEntry>(); // 按规则域隔离失效

  /** 注入只读项目快照与质量统计 worker。 */
  public constructor(options: {
    cache: QualityRuleStatisticsCacheReadPort;
    workerClient: QualityRuleStatisticsWorkerClient;
  }) {
    this.cache_reader = options.cache;
    this.worker_client = options.workerClient;
  }

  /** 读取当前规则统计；只有 miss 才捕获规则和 item 快照并启动 worker。 */
  public async read(rule_key: QualityRuleKind): Promise<QualityRuleStatisticsCacheResult> {
    const section_revisions = this.cache_reader.readSectionRevisions();
    const snapshot = this.cache_reader.snapshot();
    if (snapshot.projectPath === "") throw new AppErrors.AppError("project.not_loaded");

    const entry = this.read_entry(rule_key);
    const statistics = await (entry.statistics ?? this.compute(rule_key, entry));
    return {
      projectPath: snapshot.projectPath,
      sectionRevisions: section_revisions,
      statistics,
    };
  }

  /** 清空全部已完成结果、进行中请求引用和可复用父项。 */
  public clear(): void {
    this.values.clear();
  }

  /** 规则变化同时失效统计与父项；item 变化只失效受影响规则的统计。 */
  public applyChange(change: CacheChange): void {
    if (change.quality.mode === "full") {
      this.clear();
      return;
    }
    const scope = resolve_quality_rule_statistics_clear_scope(change);
    if (scope === "none") return;
    if (scope === "all") {
      for (const entry of this.values.values()) entry.statistics = null;
      return;
    }
    const entry = this.values.get(scope);
    if (entry !== undefined) entry.statistics = null;
  }

  /** 捕获一次不可变输入并缓存 worker Promise；失败时只移除当前请求。 */
  private compute(
    rule_key: QualityRuleKind,
    entry: QualityRuleStatisticsCacheEntry,
  ): Promise<QualityRuleStatistics> {
    const quality_block = this.cache_reader.quality.readBlock();
    const slice = read_json_record(quality_block[rule_key]);
    const input = prepare_quality_statistics_task_input({
      rule_key,
      entries: slice["entries"] ?? [],
      items: this.cache_reader.items.readItems(),
    });
    const promise = this.worker_client
      .run(
        {
          type: "quality_rule_statistics",
          input: { ...input, include_subset_parents: entry.subsetParents === null },
        },
        new AbortController().signal,
      )
      .then((result): QualityRuleStatistics => {
        const subset_parents = result.subset_parents_by_entry_id ?? entry.subsetParents;
        if (subset_parents === null) {
          throw new Error("Quality rule statistics is missing subset parent results.");
        }
        if (this.values.get(rule_key) === entry) entry.subsetParents = subset_parents;
        return { ...result, subset_parents_by_entry_id: subset_parents };
      })
      .catch((error: unknown) => {
        if (this.values.get(rule_key) === entry && entry.statistics === promise) {
          entry.statistics = null;
        }
        throw error;
      });
    entry.statistics = promise;
    return promise;
  }

  /** 读取或建立单个规则域的统计与父项槽位。 */
  private read_entry(rule_key: QualityRuleKind): QualityRuleStatisticsCacheEntry {
    const entry = this.values.get(rule_key) ?? { subsetParents: null, statistics: null };
    this.values.set(rule_key, entry);
    return entry;
  }
}

/** 把项目变化折叠为无需失效、仅译后规则或全部统计三种范围。 */
function resolve_quality_rule_statistics_clear_scope(
  change: CacheChange,
): "none" | "post_replacement" | "all" {
  if (change.items.mode === "keep") return "none";
  if (change.items.mode === "full") return "all";
  return resolve_quality_statistics_item_text_change_scope({
    source: change.source,
    fullReplace: false,
    deleteCount: change.items.deleteIds.length,
    fieldPatch: change.items.fieldPatch,
  });
}
