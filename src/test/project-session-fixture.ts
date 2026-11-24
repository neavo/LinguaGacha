/** 测试用工程路径参数，由夹具显式赋值。 */
export class ProjectSessionFixture {
  private projectPath = "";
  public async mark_loaded(path: string): Promise<void> {
    this.projectPath = path;
  }
  public async clear(): Promise<void> {
    this.projectPath = "";
  }
  public snapshot() {
    return { loaded: this.projectPath !== "", projectPath: this.projectPath };
  }
  public require_loaded_project_path(): string {
    return this.projectPath;
  }
}
