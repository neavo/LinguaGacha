// WorkerPoolExecution 由产品入口显式注入，避免运行时在底层自行猜测构建产物位置。
export type WorkerPoolExecution =
  | {
      kind: "worker_threads"; // worker_threads 是 GUI / CLI 正式任务执行路径
      workerEntryUrl: URL; // workerEntryUrl 指向构建产物中的 worker 入口文件
    }
  | {
      kind: "direct"; // direct 只用于源码测试等显式单线程执行场景
    };
