import {
  run_quality_statistics_task,
  type QualityStatisticsTaskInput,
  type QualityStatisticsTaskResult,
} from "@/app/project-runtime/quality-statistics";

type QualityStatisticsWorkerRequest = {
  id: number;
  input: QualityStatisticsTaskInput;
};

type QualityStatisticsWorkerResponse = {
  id: number;
  output: QualityStatisticsTaskResult;
};

const runtime_scope = self;

runtime_scope.addEventListener(
  "message",
  async (event: MessageEvent<QualityStatisticsWorkerRequest>) => {
    const request = event.data;
    const output = await run_quality_statistics_task(request.input);
    const response: QualityStatisticsWorkerResponse = {
      id: request.id,
      output,
    };
    runtime_scope.postMessage(response);
  },
);

export {};
