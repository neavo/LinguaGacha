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
import type { ProofreadingRuntimeEvaluatedSliceResult } from "../../shared/proofreading/proofreading-read-model";
import type { TsConversionConvertedItem } from "../../shared/ts-conversion/ts-conversion";

export type CoreWorkerTaskInputByType = {
  quality_statistics: QualityStatisticsWorkerTaskInput;
  name_field_extraction: NameFieldExtractionWorkerTaskInput;
  ts_conversion: TsConversionWorkerTaskInput;
  proofreading_hydration: ProofreadingHydrationWorkerTaskInput;
};

export type CoreWorkerTaskResultByType = {
  quality_statistics: Record<string, unknown>;
  name_field_extraction: NameFieldExtractionWorkerTaskResult;
  ts_conversion: TsConversionConvertedItem[];
  proofreading_hydration: ProofreadingRuntimeEvaluatedSliceResult;
};

export type CoreWorkerTaskType = keyof CoreWorkerTaskInputByType;

export type CoreWorkerTask = {
  [TType in CoreWorkerTaskType]: {
    type: TType;
    input: CoreWorkerTaskInputByType[TType];
  };
}[CoreWorkerTaskType];

export type CoreWorkerTaskResult<TTask extends CoreWorkerTask> =
  CoreWorkerTaskResultByType[TTask["type"]];

export async function run_worker_task<TTask extends CoreWorkerTask>(
  task: TTask,
): Promise<CoreWorkerTaskResult<TTask>> {
  switch (task.type) {
    case "quality_statistics":
      return run_quality_statistics_worker_task(task.input) as CoreWorkerTaskResult<TTask>;
    case "name_field_extraction":
      return run_name_field_extraction_worker_task(task.input) as CoreWorkerTaskResult<TTask>;
    case "ts_conversion":
      return run_ts_conversion_worker_task(task.input) as CoreWorkerTaskResult<TTask>;
    case "proofreading_hydration":
      return run_proofreading_hydration_worker_task(task.input) as CoreWorkerTaskResult<TTask>;
  }
}
