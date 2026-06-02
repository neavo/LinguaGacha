import {
  run_proofreading_sync_worker_task,
  type ProofreadingSyncWorkerTaskInput,
} from "./tasks/proofreading-sync-worker-task";
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
  ts_conversion: TsConversionWorkerTaskInput;
  proofreading_sync: ProofreadingSyncWorkerTaskInput;
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
      return run_ts_conversion_worker_task(task.input) as BackendWorkerTaskResult<TTask>;
    case "proofreading_sync":
      return run_proofreading_sync_worker_task(task.input) as BackendWorkerTaskResult<TTask>;
  }
}
