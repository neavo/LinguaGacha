import type { QualityRuleKind } from "../../domain/quality";
import { prepare_quality_statistics_task_input } from "../../shared/quality/quality-statistics-input";
import { resolve_quality_statistics_item_text_change_scope } from "../../shared/quality/quality-statistics-invalidation";
import type { ProjectDataSectionRevisions } from "../../shared/project-event";
import type {
  QualityRuleAnalysisWorkerTaskInput,
  QualityRuleAnalysisWorkerTaskResult,
} from "../worker/tasks/quality-rule-analysis-worker-task";
import type { CacheChange } from "./cache-change";
import type { CacheReadPort } from "./cache-types";
import { read_json_record } from "../../domain/json";
import * as AppErrors from "../../shared/error";

export type QualityRuleAnalysis = Omit<
  QualityRuleAnalysisWorkerTaskResult,
  "subset_parents_by_entry_id"
> & {
  subset_parents_by_entry_id: Record<string, string[]>;
};

export type QualityRuleAnalysisCacheResult = {
  projectPath: string;
  sectionRevisions: ProjectDataSectionRevisions;
  analysis: QualityRuleAnalysis;
};

type QualityRuleAnalysisCacheEntry = {
  subsetParents: Record<string, string[]> | null; // item 变化时仍可复用的字面包含父项
  analysis: Promise<QualityRuleAnalysis> | null; // 已完成结果与同 key 并发请求共用同一 Promise
};

type QualityRuleAnalysisCacheReadPort = Pick<
  CacheReadPort,
  "items" | "quality" | "readSectionRevisions" | "snapshot"
>;

type QualityRuleAnalysisWorkerClient = {
  /** 提交唯一受支持的质量分析任务，不暴露 worker 队列的其它能力。 */
  run(
    task: { type: "quality_rule_analysis"; input: QualityRuleAnalysisWorkerTaskInput },
    signal: AbortSignal,
  ): Promise<QualityRuleAnalysisWorkerTaskResult>;
};

/** 质量规则分析缓存以项目变更精准失效为准，命中时不读取或哈希全量 item。 */
export class QualityRuleAnalysisCache {
  private readonly cache_reader: QualityRuleAnalysisCacheReadPort; // 唯一规则与 item 快照来源
  private readonly worker_client: QualityRuleAnalysisWorkerClient; // 重型分析的无状态执行边界
  private readonly values = new Map<QualityRuleKind, QualityRuleAnalysisCacheEntry>(); // 按规则域隔离失效

  /** 注入只读项目快照与质量分析 worker。 */
  public constructor(options: {
    cache: QualityRuleAnalysisCacheReadPort;
    workerClient: QualityRuleAnalysisWorkerClient;
  }) {
    this.cache_reader = options.cache;
    this.worker_client = options.workerClient;
  }

  /** 读取当前规则分析；只有 miss 才捕获规则和 item 快照并启动 worker。 */
  public async read(rule_key: QualityRuleKind): Promise<QualityRuleAnalysisCacheResult> {
    const section_revisions = this.cache_reader.readSectionRevisions();
    const snapshot = this.cache_reader.snapshot();
    if (snapshot.projectPath === "") throw new AppErrors.AppError("project.not_loaded");

    const entry = this.read_entry(rule_key);
    const analysis = await (entry.analysis ?? this.compute(rule_key, entry));
    return {
      projectPath: snapshot.projectPath,
      sectionRevisions: section_revisions,
      analysis,
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
    const scope = resolve_quality_rule_analysis_clear_scope(change);
    if (scope === "none") return;
    if (scope === "all") {
      for (const entry of this.values.values()) entry.analysis = null;
      return;
    }
    const entry = this.values.get(scope);
    if (entry !== undefined) entry.analysis = null;
  }

  /** 捕获一次不可变输入并缓存 worker Promise；失败时只移除当前请求。 */
  private compute(
    rule_key: QualityRuleKind,
    entry: QualityRuleAnalysisCacheEntry,
  ): Promise<QualityRuleAnalysis> {
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
          type: "quality_rule_analysis",
          input: { ...input, include_subset_parents: entry.subsetParents === null },
        },
        new AbortController().signal,
      )
      .then((result): QualityRuleAnalysis => {
        const subset_parents = result.subset_parents_by_entry_id ?? entry.subsetParents;
        if (subset_parents === null) {
          throw new Error("Quality rule analysis is missing subset parent results.");
        }
        if (this.values.get(rule_key) === entry) entry.subsetParents = subset_parents;
        return { ...result, subset_parents_by_entry_id: subset_parents };
      })
      .catch((error: unknown) => {
        if (this.values.get(rule_key) === entry && entry.analysis === promise) {
          entry.analysis = null;
        }
        throw error;
      });
    entry.analysis = promise;
    return promise;
  }

  /** 读取或建立单个规则域的统计与父项槽位。 */
  private read_entry(rule_key: QualityRuleKind): QualityRuleAnalysisCacheEntry {
    const entry = this.values.get(rule_key) ?? { subsetParents: null, analysis: null };
    this.values.set(rule_key, entry);
    return entry;
  }
}

/** 把项目变化折叠为无需失效、仅译后规则或全部统计三种范围。 */
function resolve_quality_rule_analysis_clear_scope(
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
