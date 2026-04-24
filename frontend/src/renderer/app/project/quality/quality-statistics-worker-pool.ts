import type {
  QualityStatisticsTaskInput,
  QualityStatisticsTaskResult,
} from "@/app/project/quality/quality-statistics";

type QualityStatisticsWorkerRequest = {
  id: number;
  input: QualityStatisticsTaskInput;
};

type QualityStatisticsWorkerResponse = {
  id: number;
  output: QualityStatisticsTaskResult;
};

type WorkerTask = {
  id: number;
  input: QualityStatisticsTaskInput;
  stale_key: string | null;
  generation: number;
  resolve: (output: QualityStatisticsTaskResult) => void;
  reject: (error: Error) => void;
};

type WorkerSlot = {
  worker: Worker;
  busy: boolean;
  current_task_id: number | null;
};

export const QUALITY_STATISTICS_STALE_ERROR_MESSAGE = "quality statistics 请求已被更新请求覆盖。";

export type QualityStatisticsTaskExecutor = {
  compute: (input: QualityStatisticsTaskInput) => Promise<QualityStatisticsTaskResult>;
};

export type QualityStatisticsWorkerPool = QualityStatisticsTaskExecutor & {
  submit: (
    input: QualityStatisticsTaskInput,
    options?: {
      stale_key?: string | null;
    },
  ) => Promise<QualityStatisticsTaskResult>;
  dispose: () => void;
};

const DEFAULT_WORKER_COUNT = 4;

let shared_quality_statistics_worker_pool: QualityStatisticsWorkerPool | null = null;

function create_stale_error(): Error {
  return new Error(QUALITY_STATISTICS_STALE_ERROR_MESSAGE);
}

function create_disposed_error(): Error {
  return new Error("quality statistics worker pool 已释放。");
}

function create_worker_init_error(): Error {
  return new Error("quality statistics worker 初始化失败。");
}

function create_worker_runtime_error(): Error {
  return new Error("quality statistics worker 执行失败。");
}

export function isQualityStatisticsStaleError(error: unknown): boolean {
  return error instanceof Error && error.message === QUALITY_STATISTICS_STALE_ERROR_MESSAGE;
}

export function createQualityStatisticsWorkerPool(
  options: {
    worker_count?: number;
  } = {},
): QualityStatisticsWorkerPool {
  const worker_count = Math.max(1, options.worker_count ?? DEFAULT_WORKER_COUNT);
  let next_task_id = 0;
  let disposed = false;
  const queued_tasks: WorkerTask[] = [];
  const pending_tasks = new Map<number, WorkerTask>();
  const workers: WorkerSlot[] = [];
  const latest_generation_by_stale_key = new Map<string, number>();

  function reject_task(task: WorkerTask | undefined, error: Error): void {
    task?.reject(error);
  }

  function take_next_runnable_task(): WorkerTask | null {
    while (queued_tasks.length > 0) {
      const task = queued_tasks.shift() ?? null;
      if (task === null) {
        return null;
      }

      if (
        task.stale_key !== null &&
        latest_generation_by_stale_key.get(task.stale_key) !== task.generation
      ) {
        reject_task(task, create_stale_error());
        continue;
      }

      return task;
    }

    return null;
  }

  function create_worker_slot(): WorkerSlot {
    if (typeof Worker === "undefined") {
      throw create_worker_init_error();
    }

    try {
      const worker = new Worker(new URL("./quality-statistics-worker.ts", import.meta.url), {
        type: "module",
      });
      return {
        worker,
        busy: false,
        current_task_id: null,
      };
    } catch {
      throw create_worker_init_error();
    }
  }

  function dispatch_queued_tasks(): void {
    if (disposed) {
      return;
    }

    for (const slot of workers) {
      if (slot.busy) {
        continue;
      }

      const next_task = take_next_runnable_task();
      if (next_task === null) {
        continue;
      }

      slot.busy = true;
      slot.current_task_id = next_task.id;
      pending_tasks.set(next_task.id, next_task);
      const request: QualityStatisticsWorkerRequest = {
        id: next_task.id,
        input: next_task.input,
      };
      slot.worker.postMessage(request);
    }
  }

  function recycle_worker_slot(slot: WorkerSlot): void {
    slot.worker.terminate();
    if (disposed) {
      return;
    }

    const replacement = create_worker_slot();
    slot.worker = replacement.worker;
    slot.busy = false;
    slot.current_task_id = null;
    attach_worker_listeners(slot);
  }

  function handle_worker_message(
    slot: WorkerSlot,
    event: MessageEvent<QualityStatisticsWorkerResponse>,
  ): void {
    const task = pending_tasks.get(event.data.id);
    pending_tasks.delete(event.data.id);
    slot.busy = false;
    slot.current_task_id = null;

    if (task === undefined || disposed) {
      dispatch_queued_tasks();
      return;
    }

    if (
      task.stale_key !== null &&
      latest_generation_by_stale_key.get(task.stale_key) !== task.generation
    ) {
      task.reject(create_stale_error());
      dispatch_queued_tasks();
      return;
    }

    task.resolve(event.data.output);
    dispatch_queued_tasks();
  }

  function handle_worker_error(slot: WorkerSlot): void {
    const task =
      slot.current_task_id === null ? undefined : pending_tasks.get(slot.current_task_id);
    if (slot.current_task_id !== null) {
      pending_tasks.delete(slot.current_task_id);
    }

    slot.busy = false;
    slot.current_task_id = null;
    reject_task(task, create_worker_runtime_error());
    recycle_worker_slot(slot);
    dispatch_queued_tasks();
  }

  function attach_worker_listeners(slot: WorkerSlot): void {
    slot.worker.addEventListener(
      "message",
      (event: MessageEvent<QualityStatisticsWorkerResponse>) => {
        handle_worker_message(slot, event);
      },
    );
    slot.worker.addEventListener("error", () => {
      handle_worker_error(slot);
    });
  }

  for (let index = 0; index < worker_count; index += 1) {
    const slot = create_worker_slot();
    attach_worker_listeners(slot);
    workers.push(slot);
  }

  function dispose(): void {
    if (disposed) {
      return;
    }

    disposed = true;
    const disposed_error = create_disposed_error();

    while (queued_tasks.length > 0) {
      reject_task(queued_tasks.shift(), disposed_error);
    }

    for (const task of pending_tasks.values()) {
      task.reject(disposed_error);
    }
    pending_tasks.clear();

    workers.forEach((slot) => {
      slot.worker.terminate();
      slot.busy = false;
      slot.current_task_id = null;
    });
  }

  function submit(
    input: QualityStatisticsTaskInput,
    options: {
      stale_key?: string | null;
    } = {},
  ): Promise<QualityStatisticsTaskResult> {
    if (disposed) {
      return Promise.reject(create_disposed_error());
    }

    next_task_id += 1;
    const task_id = next_task_id;
    const stale_key = options.stale_key ?? null;
    const generation =
      stale_key === null ? 0 : (latest_generation_by_stale_key.get(stale_key) ?? 0) + 1;

    if (stale_key !== null) {
      latest_generation_by_stale_key.set(stale_key, generation);
    }

    return new Promise<QualityStatisticsTaskResult>((resolve, reject) => {
      queued_tasks.push({
        id: task_id,
        input,
        stale_key,
        generation,
        resolve,
        reject,
      });
      dispatch_queued_tasks();
    });
  }

  return {
    async compute(input: QualityStatisticsTaskInput): Promise<QualityStatisticsTaskResult> {
      return await submit(input);
    },
    submit,
    dispose,
  };
}

export function getSharedQualityStatisticsWorkerPool(): QualityStatisticsWorkerPool {
  if (shared_quality_statistics_worker_pool === null) {
    shared_quality_statistics_worker_pool = createQualityStatisticsWorkerPool();
  }

  return shared_quality_statistics_worker_pool;
}

export function resetSharedQualityStatisticsWorkerPoolForTest(): void {
  shared_quality_statistics_worker_pool?.dispose();
  shared_quality_statistics_worker_pool = null;
}
