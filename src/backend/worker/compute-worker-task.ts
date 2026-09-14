import {
  evaluateProofreadingSlice,
  type ProofreadingEvaluatedSlice,
  type ProofreadingSyncInput,
} from "../../shared/proofreading/proofreading-reader";
import {
  run_quality_rule_statistics_worker_task,
  type QualityRuleStatisticsWorkerTaskInput,
  type QualityRuleStatisticsWorkerTaskResult,
} from "./tasks/quality-rule-statistics-worker-task";

export type ComputeWorkerTaskInputByType = {
  quality_rule_statistics: QualityRuleStatisticsWorkerTaskInput;
  proofreading_sync: ProofreadingSyncInput;
};

export type ComputeWorkerTaskResultByType = {
  quality_rule_statistics: QualityRuleStatisticsWorkerTaskResult;
  proofreading_sync: ProofreadingEvaluatedSlice;
};

export type ComputeWorkerTaskName = keyof ComputeWorkerTaskInputByType;

export type ComputeWorkerTask = {
  [TType in ComputeWorkerTaskName]: {
    type: TType;
    input: ComputeWorkerTaskInputByType[TType];
  };
}[ComputeWorkerTaskName];

export type ComputeWorkerTaskResult<TTask extends ComputeWorkerTask> =
  ComputeWorkerTaskResultByType[TTask["type"]];

/** 在当前执行环境分发纯计算任务；线程入口与测试模式共用该唯一实现。 */
export async function run_compute_worker_task<TTask extends ComputeWorkerTask>(
  task: TTask,
): Promise<ComputeWorkerTaskResult<TTask>> {
  switch (task.type) {
    case "quality_rule_statistics":
      return run_quality_rule_statistics_worker_task(task.input) as ComputeWorkerTaskResult<TTask>;
    case "proofreading_sync":
      return evaluateProofreadingSlice(task.input) as ComputeWorkerTaskResult<TTask>;
  }
}
