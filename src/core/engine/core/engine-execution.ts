// EngineExecution 由产品入口显式注入，避免运行时在底层自行猜测构建产物位置或执行模式。
export type EngineExecution =
  | {
      kind: "worker_threads"; // worker_threads 是 GUI / CLI 正式任务执行路径
      workUnitWorkerEntryUrl: URL; // workUnitWorkerEntryUrl 指向构建产物中的 work unit worker 入口文件
      planningWorkerEntryUrl: URL; // planningWorkerEntryUrl 指向构建产物中的 planning worker 入口文件
    }
  | {
      // in_process 是测试和源码执行显式选择的同进程模式：不读取构建产物，不作为生产回退或兼容层。
      kind: "in_process";
    };
