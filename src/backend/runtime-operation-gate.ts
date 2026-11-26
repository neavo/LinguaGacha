import { AppError } from "../shared/error";
import type { ProjectActivity } from "../shared/runtime-activity";

type ProjectRuntime = "batch_translation" | "agent" | "agent_reset";
type ProjectOperation = "batch_translation" | "agent" | "write";
export type RuntimeLease = Readonly<{ owner: ProjectRuntime | "model_test" }>;

/** 工程任务、写入和关闭共享同一个接纳边界。 */
export class ProjectOperationGate {
  private readonly lifetime = new AbortController();
  private agent: RuntimeLease | null = null;
  private last_agent_round_started_at: number | undefined;
  private translation: RuntimeLease | null = null;
  private write: Promise<void> | null = null; // 工程关闭等待在途写入完成。
  private readonly listeners = new Set<(snapshot: ProjectActivity) => void>();

  constructor(private readonly check_global: (operation: ProjectOperation) => void = () => {}) {}

  /** 工程运行活动变化时广播快照。 */
  public subscribe(listener: (snapshot: ProjectActivity) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.get_snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  /** 租约结束后仍保留最近轮次，供侧栏在补读后恢复顺序。 */
  public get_snapshot(): ProjectActivity {
    const lastAgentRoundStartedAt = this.last_agent_round_started_at;
    return {
      batchTranslation: this.translation !== null,
      agent: this.agent !== null,
      projectWrite: this.write !== null,
      ...(lastAgentRoundStartedAt === undefined ? {} : { lastAgentRoundStartedAt }),
    };
  }

  /** 队列接续共用租约，新轮次受理后仍需发布工程活跃时间。 */
  public update_agent_round_started_at(started_at: number | undefined): void {
    if (this.last_agent_round_started_at === started_at) return;
    this.last_agent_round_started_at = started_at;
    this.changed();
  }

  public get busy(): boolean {
    return this.agent !== null || this.translation !== null || this.write !== null;
  }

  /** 重置占用 Agent 槽位，并在旧对话收尾和清理期间独占工程。 */
  public begin_runtime(owner: ProjectRuntime): RuntimeLease {
    this.lifetime.signal.throwIfAborted();
    this.check_global(owner === "agent_reset" ? "agent" : owner);
    if (
      this.agent?.owner === "agent_reset" ||
      (owner === "agent_reset" && this.busy) ||
      (owner === "agent" && this.agent !== null) ||
      (owner === "batch_translation" && (this.translation !== null || this.write !== null))
    )
      throw new AppError("runtime.busy");
    const lease = Object.freeze({ owner });
    if (owner === "batch_translation") this.translation = lease;
    else this.agent = lease;
    this.changed();
    return lease;
  }

  /** Agent 批量任务由仍在运行的父对话发起。 */
  public assert_agent_runtime(lease: RuntimeLease): void {
    if (lease !== this.agent || lease.owner !== "agent") throw new AppError("runtime.busy");
  }

  /** 迟到的收尾只能释放自己的租约。 */
  public finish_runtime(lease: RuntimeLease): void {
    if (lease === this.translation) this.translation = null;
    else if (lease === this.agent) this.agent = null;
    else return;
    this.changed();
  }

  /** GUI、CLI 和 Agent 使用同一个工程写入口。 */
  public async run_project_write<T>(
    operation: (signal: AbortSignal) => T | Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const combined = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    combined.throwIfAborted();
    this.check_global("write");
    if (this.write !== null || this.translation !== null || this.agent?.owner === "agent_reset")
      throw new AppError("runtime.busy");
    const finished = Promise.withResolvers<void>();
    this.write = finished.promise;
    this.changed();
    try {
      return await operation(combined);
    } finally {
      this.write = null;
      finished.resolve();
      this.changed();
    }
  }

  /** Agent 暂存与提交必须由活动对话发起，并共用工程写入互斥。 */
  public run_agent_project_write<T>(
    operation: (signal: AbortSignal) => T | Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.agent?.owner !== "agent") throw new AppError("runtime.busy");
    return this.run_project_write(operation, signal);
  }

  /** 停止受理，等已开始的写入结算后再关闭数据库。 */
  public async stop_project_writes(): Promise<void> {
    this.lifetime.abort(new AppError("runtime.disposed"));
    await this.write;
  }
}

/** 应用设置、认证、模型测试和文件打开协调独立于工程闸。 */
export class GlobalOperationGate {
  private readonly lifetime = new AbortController();
  private model_test: RuntimeLease | null = null;
  private auth_write = false;
  private skill_write = false;
  private lifecycle: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly all_projects_idle: () => boolean = () => true,
    private readonly agents_idle: () => boolean = () => true,
    private readonly changed: () => void = () => {},
  ) {}

  public get can_change_auth(): boolean {
    return !this.auth_write && this.model_test === null && this.all_projects_idle();
  }

  public get modelTest(): boolean {
    return this.model_test !== null;
  }

  /** 应用级写入只阻止会消费相关事实的新工程操作。 */
  public check_project(owner: ProjectOperation): void {
    if ((owner !== "write" && this.auth_write) || (owner === "agent" && this.skill_write))
      throw new AppError("runtime.busy");
  }

  public begin_runtime(owner: "model_test"): RuntimeLease {
    if (this.model_test !== null || this.auth_write) throw new AppError("runtime.busy");
    const lease = Object.freeze({ owner });
    this.model_test = lease;
    this.changed();
    return lease;
  }

  public finish_runtime(lease: RuntimeLease): void {
    if (lease !== this.model_test) return;
    this.model_test = null;
    this.changed();
  }

  /** 认证变更前等工程和模型测试空闲。 */
  public async run_model_auth_write<T>(operation: () => Promise<T>): Promise<T> {
    if (this.auth_write || this.model_test !== null || !this.all_projects_idle())
      throw new AppError("runtime.busy");
    this.auth_write = true;
    try {
      return await operation();
    } finally {
      this.auth_write = false;
    }
  }

  /** 技能编辑与对话执行互斥。 */
  public async run_skill_write<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.skill_write || !this.agents_idle()) throw new AppError("runtime.busy");
    this.skill_write = true;
    try {
      return await operation();
    } finally {
      this.skill_write = false;
    }
  }

  /** 串行处理磁盘工程的生命周期操作。 */
  public async run_lifecycle<T>(operation: (signal: AbortSignal) => T | Promise<T>): Promise<T> {
    const next = this.lifecycle.then(async () => {
      this.lifetime.signal.throwIfAborted();
      return await operation(this.lifetime.signal);
    });
    this.lifecycle = next.catch(() => {});
    return await next;
  }

  public async stop(): Promise<void> {
    this.lifetime.abort(new AppError("runtime.disposed"));
    await this.lifecycle;
  }
}
