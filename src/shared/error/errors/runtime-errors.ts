import { AppError, type AppErrorPublicDetails } from "../app-error";

/**
 * RuntimeCapabilityMissingError 表示当前 Electron / Node 缺少必要运行能力。
 */
export class RuntimeCapabilityMissingError extends AppError {
  /**
   * 能力名称只能通过安全 details 公开，运行时对象本身不能穿过 API。
   */
  public constructor(args: { public_details?: AppErrorPublicDetails; cause?: unknown } = {}) {
    super({ code: "runtime.capability_missing", ...args });
  }
}

/**
 * InternalInvariantError 是未知异常和内部不变量破坏的唯一包装。
 */
export class InternalInvariantError extends AppError {
  /**
   * 未知原始值必须放在 cause，公开文案由 i18n 键统一解析。
   */
  public constructor(
    args: {
      public_details?: AppErrorPublicDetails;
      diagnostic_context?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super({ code: "runtime.internal_invariant", ...args });
  }

  /**
   * 未知边界值统一保留 cause，禁止 Gateway 再按 message 猜测业务语义。
   */
  public static from_unknown(error: unknown): InternalInvariantError {
    return new InternalInvariantError({ cause: error });
  }
}
