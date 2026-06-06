import { run_quality_statistics_task_sync } from "../../../shared/quality/quality-statistics";
import type { QualityStatisticsPreparedTaskInput } from "../../../shared/quality/quality-statistics-input";

// worker 只接收 cache 侧准备好的 plain input，避免跨线程重复解释项目事实。
export type QualityStatisticsWorkerTaskInput = QualityStatisticsPreparedTaskInput;

/**
 * 执行质量统计纯计算，并把结果封装成前端统计缓存可直接消费的快照。
 */
export function run_quality_statistics_worker_task(
  input: QualityStatisticsWorkerTaskInput,
): Record<string, unknown> {
  const statistics_result = run_quality_statistics_task_sync({
    rules: input.rules,
    srcTextGroups: input.src_text_groups,
    dstTextGroups: input.dst_text_groups,
    relationCandidates: input.relation_candidates,
  });
  // 输出表按 completed_entry_ids 补齐缺失项，保证页面读取时无需再做空 key 分支。
  const matched_count_by_entry_id = Object.fromEntries(
    input.completed_entry_ids.map((entry_id) => {
      return [entry_id, statistics_result.results[entry_id]?.matched_item_count ?? 0];
    }),
  );
  // subset parents 与命中数使用同一 key 集合，保持统计快照形状稳定。
  const subset_parent_labels_by_entry_id = Object.fromEntries(
    input.completed_entry_ids.map((entry_id) => {
      return [entry_id, statistics_result.results[entry_id]?.subset_parents ?? []];
    }),
  );
  return {
    phase: "current",
    current_snapshot: input.completed_snapshot,
    completed_snapshot: input.completed_snapshot,
    completed_entry_ids: input.completed_entry_ids,
    matched_count_by_entry_id,
    subset_parent_labels_by_entry_id,
    last_error: null,
    request_token: 0,
    updated_at: Date.now(),
  };
}
