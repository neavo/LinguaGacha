import { AppError } from "../shared/error";
import type { ProjectActivity } from "../shared/runtime-activity";

type Owner = "batch_translation" | "agent" | "model_test";
type ProjectOperation = "batch_translation" | "agent" | "write";
export type RuntimeLease = Readonly<{ owner: Owner }>;

/** 工程任务、写入和关闭共享同一个接纳边界。 */
export class ProjectOperationGate {
  private readonly lifetime = new AbortController();
  private readonly agents = new Set<RuntimeLease>(); // 每条对话单独占用，释放时按租约身份定位。
  private translation: RuntimeLease | null = null;
  private write: Promise<void> | null = null; // 工程关闭等待在途写入完成。
  private readonly listeners = new Set<(snapshot: ProjectActivity) => void>();

  constructor(private readonly check_global: (operation: ProjectOperation) => void = () => {}) {}

  /** 只有占用变更需要广播运行快照。 */
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

  public get_snapshot(): ProjectActivity {
    return {
      batchTranslation: this.translation !== null,
      activeChatCount: this.agents.size,
      projectWrite: this.write !== null,
    };
  }

  public get busy(): boolean {
    return this.agents.size > 0 || this.translation !== null || this.write !== null;
  }

  /** 同工程允许多条对话执行，翻译与写入各自独占。 */
  public begin_runtime(owner: "batch_translation" | "agent"): RuntimeLease {
    this.lifetime.signal.throwIfAborted();
    this.check_global(owner);
    if (owner === "batch_translation" && (this.translation !== null || this.write !== null))
      throw new AppError("runtime.busy");
    const lease = Object.freeze({ owner });
    if (owner === "agent") this.agents.add(lease);
    else this.translation = lease;
    this.changed();
    return lease;
  }

  /** Agent 批量任务由仍在运行的父对话发起。 */
  public assert_agent_runtime(lease: RuntimeLease): void {
    if (!this.agents.has(lease)) throw new AppError("runtime.busy");
  }

  /** 迟到的收尾只能释放自己的租约。 */
  public finish_runtime(lease: RuntimeLease): void {
    if (lease === this.translation) this.translation = null;
    else if (!this.agents.delete(lease)) return;
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
    if (this.write !== null || this.translation !== null) throw new AppError("runtime.busy");
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
    if (this.agents.size === 0) throw new AppError("runtime.busy");
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
  private settings_write = false;
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
    if (
      this.settings_write ||
      (owner !== "write" && this.auth_write) ||
      (owner === "agent" && this.skill_write)
    )
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

  /** 只有磁盘工程生命周期和实验室同步在此串行，工程日常操作不经过它。 */
  public async run_lifecycle<T>(operation: (signal: AbortSignal) => T | Promise<T>): Promise<T> {
    const next = this.lifecycle.then(async () => {
      this.lifetime.signal.throwIfAborted();
      return await operation(this.lifetime.signal);
    });
    this.lifecycle = next.catch(() => {});
    return await next;
  }

  /** 同步多个工程设置期间封住新工程操作。 */
  public run_laboratory<T>(operation: () => Promise<T>): Promise<T> {
    return this.run_lifecycle(async () => {
      if (!this.all_projects_idle()) throw new AppError("runtime.busy");
      this.settings_write = true;
      try {
        return await operation();
      } finally {
        this.settings_write = false;
      }
    });
  }

  public async stop(): Promise<void> {
    this.lifetime.abort(new AppError("runtime.disposed"));
    await this.lifecycle;
  }
}
