import {
  evaluateProofreadingSlice,
  type ProofreadingEvaluatedSlice,
  type ProofreadingSyncInput,
} from "../../shared/proofreading/proofreading-reader";
import {
  build_ts_conversion_converted_items,
  type TsConversionConvertedItem,
  type TsConversionDirection,
  type TsConversionItem,
} from "../../shared/text/ts-conversion";
import type { TextPreserveEntry } from "../../domain/quality";
import {
  run_quality_statistics_worker_task,
  type QualityStatisticsWorkerTaskInput,
} from "./tasks/quality-statistics-worker-task";

type TsConversionWorkerTaskInput = {
  items: TsConversionItem[];
  direction: TsConversionDirection;
  convert_name: boolean;
  preserve_text: boolean;
  text_preserve_mode: string;
  text_preserve_entries: TextPreserveEntry[];
};

export type ComputeWorkerTaskInputByType = {
  quality_statistics: QualityStatisticsWorkerTaskInput;
  ts_conversion: TsConversionWorkerTaskInput;
  proofreading_sync: ProofreadingSyncInput;
};

export type ComputeWorkerTaskResultByType = {
  quality_statistics: Record<string, unknown>;
  ts_conversion: TsConversionConvertedItem[];
  proofreading_sync: ProofreadingEvaluatedSlice;
};

export type ComputeWorkerTaskType = keyof ComputeWorkerTaskInputByType;

export type ComputeWorkerTask = {
  [TType in ComputeWorkerTaskType]: {
    type: TType;
    input: ComputeWorkerTaskInputByType[TType];
  };
}[ComputeWorkerTaskType];

export type ComputeWorkerTaskResult<TTask extends ComputeWorkerTask> =
  ComputeWorkerTaskResultByType[TTask["type"]];

/** 在当前执行环境分发纯计算任务；线程入口与测试模式共用该唯一实现。 */
export async function run_compute_worker_task<TTask extends ComputeWorkerTask>(
  task: TTask,
): Promise<ComputeWorkerTaskResult<TTask>> {
  switch (task.type) {
    case "quality_statistics":
      return run_quality_statistics_worker_task(task.input) as ComputeWorkerTaskResult<TTask>;
    case "ts_conversion":
      return build_ts_conversion_converted_items(task.input) as ComputeWorkerTaskResult<TTask>;
    case "proofreading_sync":
      return evaluateProofreadingSlice(task.input) as ComputeWorkerTaskResult<TTask>;
  }
}
