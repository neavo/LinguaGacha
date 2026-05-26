const DEFAULT_ENGINE_WORKER_COUNT_LIMIT = 4; // 默认上限保护前台交互和 I/O，不让 worker 数无限追随核心数。
const RESERVED_MAIN_PROCESS_PARALLELISM = 1; // 默认至少给主线程保留一个执行槽位。

/**
 * 统一解析项目后台 worker 默认容量；显式 workerCount 只做正整数收口。
 */
export function resolve_default_worker_count(args: {
  workerCount?: number;
  availableParallelism: number;
}): number {
  if (args.workerCount !== undefined) {
    return Math.max(1, Math.trunc(args.workerCount));
  }

  const available_parallelism = Math.max(1, Math.trunc(args.availableParallelism));
  const default_worker_count = Math.min(
    DEFAULT_ENGINE_WORKER_COUNT_LIMIT,
    available_parallelism - RESERVED_MAIN_PROCESS_PARALLELISM,
  );
  return Math.max(1, default_worker_count);
}
