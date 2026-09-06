import * as AppErrors from "../../shared/error";

export type ProjectSessionSnapshot = {
  loaded: boolean;
  projectPath: string;
};

export type ProjectSessionChange = ProjectSessionSnapshot & {
  sessionRevision: number;
};

export type ProjectSessionChangeListener = (
  change: Readonly<ProjectSessionChange>,
) => void | Promise<void>;

/**
 * 当前 loaded 工程身份的唯一内存所有者；GUI / CLI / BatchTranslationRuntime 共用同一会话世代。
 */
export class ProjectSessionState {
  private project_path = "";

  private loaded = false;

  private session_revision = 0; // 每次 load/clear 都推进，订阅者据此切断旧工程运行态

  private readonly change_listeners = new Set<ProjectSessionChangeListener>();

  /**
   * 成功加载或新建工程后更新会话，失败响应不得改写状态。
   */
  public async mark_loaded(project_path: string): Promise<void> {
    const normalized_path = project_path.trim();
    this.project_path = normalized_path;
    this.loaded = normalized_path !== "";
    this.session_revision += 1;
    await this.publish_change();
  }

  /**
   * 卸载成功后清空公开会话状态。
   */
  public async clear(): Promise<void> {
    this.project_path = "";
    this.loaded = false;
    this.session_revision += 1;
    await this.publish_change();
  }

  /**
   * 会话身份订阅只承载 load/clear 边界，取消函数移除当前订阅者。
   */
  public subscribe_change(listener: ProjectSessionChangeListener): () => void {
    this.change_listeners.add(listener);
    return () => {
      this.change_listeners.delete(listener);
    };
  }

  /**
   * 返回不可变快照，避免调用方共享可变状态引用。
   */
  public snapshot(): ProjectSessionSnapshot {
    return {
      loaded: this.loaded,
      projectPath: this.loaded ? this.project_path : "",
    };
  }

  /**
   * 返回当前 loaded 工程的唯一写入目标，避免空路径意外创建 SQLite 文件。
   */
  public require_loaded_project_path(): string {
    if (!this.loaded || this.project_path === "") {
      throw new AppErrors.AppError("project.not_loaded");
    }
    return this.project_path;
  }

  /**
   * 生命周期调用方等待所有订阅者落稳，避免 HTTP 成功早于新会话运行态发布。
   */
  private async publish_change(): Promise<void> {
    const change: ProjectSessionChange = {
      ...this.snapshot(),
      sessionRevision: this.session_revision,
    };
    const results = await Promise.allSettled(
      Array.from(this.change_listeners, (listener) =>
        Promise.resolve().then(async () => await listener(change)),
      ),
    );
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to publish project session changes.");
    }
  }
}
