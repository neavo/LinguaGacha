import { AppError, type AppErrorArgs } from "../app-error";

/** 当前 Electron / Node 环境缺少必要运行能力。 */
export class RuntimeCapabilityMissingError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "runtime.capability_missing", ...args });
  }
}

/** 运行资源已经释放，调用方不能继续提交工作。 */
export class RuntimeDisposedError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "runtime.disposed", ...args });
  }
}

/** 调用方主动取消，不能与内部故障混为一类。 */
export class RuntimeCancelledError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "runtime.cancelled", ...args });
  }
}

/** 未知异常和内部不变量破坏的统一包装。 */
export class InternalInvariantError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "runtime.internal_invariant", ...args });
  }

  /** 未知边界值统一保留 cause，禁止上层再按 message 猜测语义。 */
  public static from_unknown(error: unknown): InternalInvariantError {
    return new InternalInvariantError({ cause: error });
  }
}
