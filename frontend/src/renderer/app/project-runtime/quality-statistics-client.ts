import type {
  QualityStatisticsRelationCandidate,
  QualityStatisticsRuleInput,
  QualityStatisticsTaskInput,
  QualityStatisticsTaskResult,
} from "@/app/project-runtime/quality-statistics";

type PendingResolver = {
  resolve: (output: QualityStatisticsTaskResult) => void;
  reject: (error: Error) => void;
};

type QualityStatisticsWorkerResponse = {
  id: number;
  output: QualityStatisticsTaskResult;
};

export const QUALITY_STATISTICS_STALE_ERROR_MESSAGE = "quality statistics 请求已被更新请求覆盖。";

export type QualityStatisticsClient = {
  compute: (input: QualityStatisticsTaskInput) => Promise<QualityStatisticsTaskResult>;
  dispose: () => void;
};

function reject_all(pending_requests: Map<number, PendingResolver>, error: Error): void {
  for (const resolver of pending_requests.values()) {
    resolver.reject(error);
  }
  pending_requests.clear();
}

function reject_stale_requests(
  pending_requests: Map<number, PendingResolver>,
  active_request_id: number,
): void {
  for (const [request_id, resolver] of pending_requests.entries()) {
    if (request_id === active_request_id) {
      continue;
    }

    resolver.reject(new Error(QUALITY_STATISTICS_STALE_ERROR_MESSAGE));
    pending_requests.delete(request_id);
  }
}

export function isQualityStatisticsStaleError(error: unknown): boolean {
  return error instanceof Error && error.message === QUALITY_STATISTICS_STALE_ERROR_MESSAGE;
}

export function createQualityStatisticsClient(): QualityStatisticsClient {
  let next_request_id = 0;
  let worker: Worker | null = null;
  const pending_requests = new Map<number, PendingResolver>();

  function ensure_worker(): Worker {
    if (worker !== null) {
      return worker;
    }

    if (typeof Worker === "undefined") {
      throw new Error("当前环境不支持 quality statistics worker。");
    }

    try {
      worker = new Worker(new URL("./quality-statistics-worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      worker = null;
      throw new Error("quality statistics worker 初始化失败。");
    }

    worker.addEventListener("message", (event: MessageEvent<QualityStatisticsWorkerResponse>) => {
      const resolver = pending_requests.get(event.data.id);
      if (resolver === undefined) {
        return;
      }

      pending_requests.delete(event.data.id);
      resolver.resolve(event.data.output);
    });
    worker.addEventListener("error", () => {
      reject_all(pending_requests, new Error("quality statistics worker 执行失败。"));
      worker?.terminate();
      worker = null;
    });

    return worker;
  }

  return {
    async compute(input: QualityStatisticsTaskInput): Promise<QualityStatisticsTaskResult> {
      const runtime_worker = ensure_worker();

      next_request_id += 1;
      const request_id = next_request_id;

      return await new Promise<QualityStatisticsTaskResult>((resolve, reject) => {
        pending_requests.set(request_id, { resolve, reject });
        reject_stale_requests(pending_requests, request_id);
        runtime_worker.postMessage({
          id: request_id,
          input,
        });
      });
    },
    dispose(): void {
      reject_all(pending_requests, new Error("quality statistics worker 已释放。"));
      worker?.terminate();
      worker = null;
    },
  };
}

export type {
  QualityStatisticsRelationCandidate,
  QualityStatisticsRuleInput,
  QualityStatisticsTaskInput,
  QualityStatisticsTaskResult,
};
