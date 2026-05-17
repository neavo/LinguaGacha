import { AppError, type AppErrorArgs } from "../app-error";

/**
 * RuntimeCapabilityMissingError 表示当前 Electron / Node 缺少必要运行能力。
 */
export class RuntimeCapabilityMissingError extends AppError {
  /**
   * 能力名称只能通过安全 details 公开，运行时对象本身不能穿过 API。
   */
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "runtime.capability_missing", ...args });
  }
}

/**
 * RuntimeDisposedError 表示运行资源已经释放，调用方不能继续提交工作。
 */
export class RuntimeDisposedError extends AppError {
  /**
   * resource 这类安全名称可公开，具体实例和内部状态只进诊断上下文。
   */
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "runtime.disposed", ...args });
  }
}

/**
 * RuntimeCancelledError 表示调用方主动取消，不能和内部故障混为一类。
 */
export class RuntimeCancelledError extends AppError {
  /**
   * 取消来源只作为安全 details 或诊断信息传递，不使用自然语言 message 分支。
   */
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "runtime.cancelled", ...args });
  }
}

/**
 * InternalInvariantError 是未知异常和内部不变量破坏的唯一包装。
 */
export class InternalInvariantError extends AppError {
  /**
   * 未知原始值必须放在 cause，公开文案由 i18n 键统一解析。
   */
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "runtime.internal_invariant", ...args });
  }

  /**
   * 未知边界值统一保留 cause，禁止 Gateway 再按 message 猜测业务语义。
   */
  public static from_unknown(error: unknown): InternalInvariantError {
    return new InternalInvariantError({ cause: error });
  }
}
