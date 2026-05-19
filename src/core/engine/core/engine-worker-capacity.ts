import os from "node:os";

const DEFAULT_ENGINE_WORKER_COUNT_LIMIT = 4; // 默认上限保护本机交互和 I/O，不让 CPU 计数线程无限追随核心数。
const RESERVED_MAIN_PROCESS_PARALLELISM = 1; // 默认至少给 Electron/Core 主进程保留一个执行槽位。

/**
 * 统一解析 work unit worker 与 planning worker 的默认容量，显式 workerCount 只做正整数收口。
 */
export function resolve_engine_worker_count(worker_count: number | undefined): number {
  if (worker_count !== undefined) {
    return Math.max(1, Math.trunc(worker_count));
  }

  const available_parallelism = Math.max(1, os.availableParallelism?.() ?? os.cpus().length);
  const default_worker_count = Math.min(
    DEFAULT_ENGINE_WORKER_COUNT_LIMIT,
    available_parallelism - RESERVED_MAIN_PROCESS_PARALLELISM,
  );
  return Math.max(1, default_worker_count);
}
