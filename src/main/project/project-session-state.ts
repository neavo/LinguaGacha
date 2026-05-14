/**
 * 保存 API Gateway 对外公开的项目会话状态
 */
export class ProjectSessionState {
  private project_path = "";

  private loaded = false;

  /**
   * 成功加载或新建工程后由 Gateway 包装路由更新，失败响应不得改写状态
   */
  public mark_loaded(project_path: string): void {
    const normalized_path = project_path.trim();
    if (normalized_path === "") {
      this.clear();
      return;
    }
    this.project_path = normalized_path;
    this.loaded = true;
  }

  /**
   * 卸载成功后清空公开会话状态
   */
  public clear(): void {
    this.project_path = "";
    this.loaded = false;
  }

  /**
   * 返回不可变快照，避免调用方共享可变状态引用
   */
  public snapshot(): { loaded: boolean; projectPath: string } {
    return {
      loaded: this.loaded,
      projectPath: this.loaded ? this.project_path : "",
    };
  }
}
