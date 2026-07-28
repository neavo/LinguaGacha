import {
  evaluateProofreadingSlice,
  type ProofreadingEvaluatedSlice,
  type ProofreadingSyncInput,
} from "../../shared/proofreading/proofreading-list-reader";
import {
  build_ts_conversion_converted_items,
  type TsConversionConvertedItem,
  type TsConversionDirection,
  type TsConversionItem,
} from "../../shared/text/ts-conversion";
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
  custom_rules: string[];
  preset_rules_by_text_type: Record<string, string[]>;
};

export type BackendWorkerTaskInputByType = {
  quality_statistics: QualityStatisticsWorkerTaskInput;
  ts_conversion: TsConversionWorkerTaskInput;
  proofreading_sync: ProofreadingSyncInput;
};

export type BackendWorkerTaskResultByType = {
  quality_statistics: Record<string, unknown>;
  ts_conversion: TsConversionConvertedItem[];
  proofreading_sync: ProofreadingEvaluatedSlice;
};

export type BackendWorkerTaskType = keyof BackendWorkerTaskInputByType;

export type BackendWorkerTask = {
  [TType in BackendWorkerTaskType]: {
    type: TType;
    input: BackendWorkerTaskInputByType[TType];
  };
}[BackendWorkerTaskType];

export type BackendWorkerTaskResult<TTask extends BackendWorkerTask> =
  BackendWorkerTaskResultByType[TTask["type"]];

export async function run_worker_task<TTask extends BackendWorkerTask>(
  task: TTask,
): Promise<BackendWorkerTaskResult<TTask>> {
  switch (task.type) {
    case "quality_statistics":
      return run_quality_statistics_worker_task(task.input) as BackendWorkerTaskResult<TTask>;
    case "ts_conversion":
      return build_ts_conversion_converted_items(task.input) as BackendWorkerTaskResult<TTask>;
    case "proofreading_sync":
      return evaluateProofreadingSlice(task.input) as BackendWorkerTaskResult<TTask>;
  }
}
