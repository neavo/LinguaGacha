import type { RuntimeActivityOwner, RuntimeActivitySnapshot } from "../shared/runtime-activity";
import * as AppErrors from "../shared/error";

export type RuntimeLease = Readonly<{ owner: RuntimeActivityOwner }>;
export type RuntimeActivityListener = (snapshot: Readonly<RuntimeActivitySnapshot>) => void;

/**
 * 翻译、Agent、接口测试与工程写入的唯一互斥所有者。
 */
export class RuntimeOperationGate {
  private active_runtime: RuntimeLease | null = null; // 对象身份同时承担迟到释放校验
  private project_write_running = false; // 项目写不公开为模型 owner，只阻止并发运行与写入
  private skill_write_running = false; // 技能保存到集合发布期间阻止 Agent 取得执行占用。
  private revision = 0; // 仅在公开 owner 变化时推进
  private readonly listeners = new Set<RuntimeActivityListener>(); // 组合根用它桥接 SSE
  private readonly idle_waiters = new Set<() => void>(); // 目录应用等待运行与工程写入都释放

  /** 返回不可变值形状，调用方不能取得内部 lease。 */
  public get_snapshot(): RuntimeActivitySnapshot {
    return { revision: this.revision, owner: this.active_runtime?.owner ?? null };
  }

  /** 订阅公开 owner 变化；取消函数只移除当前 listener。 */
  public subscribe(listener: RuntimeActivityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 同步占用保证检查与首个异步阶段之间没有并发窗口。 */
  public begin_runtime(owner: RuntimeActivityOwner): RuntimeLease {
    if (
      this.active_runtime !== null ||
      this.project_write_running ||
      (owner === "agent" && this.skill_write_running)
    ) {
      throw new AppErrors.AppError("runtime.busy");
    }
    const lease = Object.freeze({ owner });
    this.active_runtime = lease;
    try {
      this.publish_snapshot();
    } catch (error) {
      this.active_runtime = null;
      throw error;
    }
    return lease;
  }

  /** Agent 内执行必须出自当前 round 的真实 lease 对象。 */
  public assert_current_runtime(lease: RuntimeLease, owner: RuntimeActivityOwner): void {
    if (this.active_runtime !== lease || lease.owner !== owner) {
      throw new AppErrors.AppError("runtime.busy");
    }
  }

  /** 迟到清理只允许释放自己取得的 lease，不能误伤后续运行。 */
  public finish_runtime(lease: RuntimeLease): void {
    if (this.active_runtime !== lease) return;
    this.active_runtime = null;
    this.publish_snapshot();
    this.notify_idle();
  }

  /** 等待所有运行与工程写入口空闲；调用方随后仍须同步取得写租约。 */
  public async wait_for_idle(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.active_runtime === null && !this.project_write_running) return;
    await new Promise<void>((resolve, reject) => {
      const settle = (): void => {
        cleanup();
        resolve();
      };
      const abort = (): void => {
        cleanup();
        reject(signal.reason);
      };
      const cleanup = (): void => {
        this.idle_waiters.delete(settle);
        signal.removeEventListener("abort", abort);
      };
      this.idle_waiters.add(settle);
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  /** 用户写入和工程生命周期操作要求整个模型运行时空闲。 */
  public async run_project_write<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.active_runtime !== null || this.project_write_running) {
      throw new AppErrors.AppError("runtime.busy");
    }
    return await this.run_project_write_under_lease(operation);
  }

  /** 技能修改只与 Agent 执行互斥；技能命令之间由技能服务串行处理。 */
  public async run_skill_write<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.active_runtime?.owner === "agent" || this.skill_write_running)
      throw new AppErrors.AppError("runtime.busy");
    this.skill_write_running = true;
    try {
      return await operation();
    } finally {
      this.skill_write_running = false;
    }
  }

  /** Agent 写工具复用项目写串行 lease，但只能在自己的运行回合内调用。 */
  public async run_agent_project_write<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.active_runtime?.owner !== "agent" || this.project_write_running) {
      throw new AppErrors.AppError("runtime.busy");
    }
    return await this.run_project_write_under_lease(operation);
  }

  /** 普通写与 Agent 写最终都在这里持有同一串行标记。 */
  private async run_project_write_under_lease<T>(operation: () => Promise<T> | T): Promise<T> {
    this.project_write_running = true;
    try {
      return await operation();
    } finally {
      this.project_write_running = false;
      this.notify_idle();
    }
  }

  /** 运行和写入均释放后唤醒等待方，等待方取得占用前仍须复查。 */
  private notify_idle(): void {
    if (this.active_runtime !== null || this.project_write_running) return;
    for (const waiter of this.idle_waiters) waiter();
  }

  /** owner 每次变化都发布完整快照，消费者只按 revision 排序。 */
  private publish_snapshot(): void {
    this.revision += 1;
    const snapshot = this.get_snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
