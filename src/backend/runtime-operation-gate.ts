import type { RuntimeActivityOwner, RuntimeActivitySnapshot } from "../shared/runtime-activity";
import * as AppErrors from "../shared/error";

export type RuntimeLease = Readonly<{ owner: RuntimeActivityOwner }>;
export type RuntimeActivityListener = (snapshot: Readonly<RuntimeActivitySnapshot>) => void;

/**
 * 普通任务、Agent 与结构性项目写入的唯一互斥所有者。
 */
export class RuntimeOperationGate {
  private active_runtime: RuntimeLease | null = null; // 对象身份同时承担迟到释放校验
  private project_write_running = false; // 项目写不公开为模型 owner，只阻止并发运行与写入
  private revision = 0; // 仅在公开 owner 变化时推进
  private readonly listeners = new Set<RuntimeActivityListener>(); // 组合根用它桥接 SSE

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
    if (this.active_runtime !== null || this.project_write_running) {
      throw new AppErrors.AppError("runtime.busy");
    }
    const lease = Object.freeze({ owner });
    this.active_runtime = lease;
    this.publish_snapshot();
    return lease;
  }

  /** 迟到清理只允许释放自己取得的 lease，不能误伤后续运行。 */
  public finish_runtime(lease: RuntimeLease): void {
    if (this.active_runtime !== lease) return;
    this.active_runtime = null;
    this.publish_snapshot();
  }

  /** 设置与模型配置等同步写入口在提交前复用同一空闲检查。 */
  public assert_runtime_idle(): void {
    if (this.active_runtime !== null) throw new AppErrors.AppError("runtime.busy");
  }

  /** 用户写入和工程生命周期操作要求整个模型运行时空闲。 */
  public async run_project_write<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.active_runtime !== null || this.project_write_running) {
      throw new AppErrors.AppError("runtime.busy");
    }
    return await this.run_project_write_under_lease(operation);
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
    }
  }

  /** owner 每次变化都发布完整快照，消费者只按 revision 排序。 */
  private publish_snapshot(): void {
    this.revision += 1;
    const snapshot = this.get_snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
