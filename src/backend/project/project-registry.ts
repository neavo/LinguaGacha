import { default_native_fs } from "../../native/native-fs";
import { AppError } from "../../shared/error";

/** 登记按打开周期寻址，路径复用只在串行打开工程时检查。 */
export class ProjectRegistry<Project extends { id: string; path: string }> {
  private readonly projects = new Map<string, Project>();

  /** 按打开顺序遍历工程，供关闭和全局设置同步使用。 */
  public values(): IterableIterator<Project> {
    return this.projects.values();
  }

  /** HTTP 请求只能使用仍在登记中的 `projectId`。 */
  public require(id: unknown): Project {
    if (typeof id !== "string" || id === "")
      throw new AppError("request.validation_failed", { public_details: { field: "projectId" } });
    const project = this.projects.get(id);
    if (project === undefined) throw new AppError("project.not_loaded");
    return project;
  }

  /** 路径比较遵循应用当前平台的文件身份规则。 */
  public find(path: string): Project | undefined {
    const identity = default_native_fs.to_identity_path(path);
    return this.projects
      .values()
      .find((project) => default_native_fs.to_identity_path(project.path) === identity);
  }

  /** 安装完成后在生命周期闸内登记。 */
  public add(project: Project): void {
    this.projects.set(project.id, project);
  }

  /** 生命周期收尾释放此打开周期的路由身份。 */
  public remove(project: Project): void {
    this.projects.delete(project.id);
  }
}
