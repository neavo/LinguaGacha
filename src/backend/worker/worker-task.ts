import {
  run_name_field_extraction_worker_task,
  type NameFieldExtractionWorkerTaskInput,
  type NameFieldExtractionWorkerTaskResult,
} from "./tasks/name-field-extraction-worker-task";
import {
  run_proofreading_hydration_worker_task,
  type ProofreadingHydrationWorkerTaskInput,
} from "./tasks/proofreading-hydration-worker-task";
import {
  run_quality_statistics_worker_task,
  type QualityStatisticsWorkerTaskInput,
} from "./tasks/quality-statistics-worker-task";
import {
  run_ts_conversion_worker_task,
  type TsConversionWorkerTaskInput,
} from "./tasks/ts-conversion-worker-task";
import type { ProofreadingEvaluatedSlice } from "../../shared/proofreading/proofreading-list-reader";
import type { TsConversionConvertedItem } from "../../shared/toolbox/ts-conversion";

export type BackendWorkerTaskInputByType = {
  quality_statistics: QualityStatisticsWorkerTaskInput;
  name_field_extraction: NameFieldExtractionWorkerTaskInput;
  ts_conversion: TsConversionWorkerTaskInput;
  proofreading_hydration: ProofreadingHydrationWorkerTaskInput;
};

export type BackendWorkerTaskResultByType = {
  quality_statistics: Record<string, unknown>;
  name_field_extraction: NameFieldExtractionWorkerTaskResult;
  ts_conversion: TsConversionConvertedItem[];
  proofreading_hydration: ProofreadingEvaluatedSlice;
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
    case "name_field_extraction":
      return run_name_field_extraction_worker_task(task.input) as BackendWorkerTaskResult<TTask>;
    case "ts_conversion":
      return run_ts_conversion_worker_task(task.input) as BackendWorkerTaskResult<TTask>;
    case "proofreading_hydration":
      return run_proofreading_hydration_worker_task(task.input) as BackendWorkerTaskResult<TTask>;
  }
}
