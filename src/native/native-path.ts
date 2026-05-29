import path from "node:path";

/**
 * Backend / worker 平台路径策略，统一处理 Windows namespaced path 与路径身份比较。
 */
export class NativePathPolicy {
  /**
   * platform 允许测试显式模拟目标平台，运行态默认读取当前 Node 平台。
   */
  public constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  /**
   * 按目标平台解析路径，避免测试模拟平台时混入宿主系统分隔符规则。
   */
  private resolve_path(file_path: string): string {
    return this.platform === "win32"
      ? path.win32.resolve(file_path)
      : path.posix.resolve(file_path);
  }

  /**
   * 将文件系统 IO 路径转换为当前平台原生可接受形态。
   */
  public to_native_path(file_path: string): string {
    if (this.platform !== "win32") {
      return file_path;
    }
    return path.win32.toNamespacedPath(file_path);
  }

  /**
   * 生成用于路径去重和连接表索引的稳定身份，避免 Windows 大小写差异造成重复打开。
   */
  public to_identity_path(file_path: string): string {
    const resolved_path = this.resolve_path(file_path);
    return this.platform === "win32" ? resolved_path.toLowerCase() : resolved_path;
  }

  /**
   * 判断路径是否已经是文件系统根，根目录存在性由平台保证，不能当成待创建目录。
   */
  public is_filesystem_root(directory: string): boolean {
    const resolved_path = this.resolve_path(directory);
    const parsed_path =
      this.platform === "win32" ? path.win32.parse(resolved_path) : path.posix.parse(resolved_path);
    return resolved_path === parsed_path.root;
  }

  /**
   * 暴露平台判断给需要保持旧语义的调用方，避免散落 process.platform 判断。
   */
  public is_windows(): boolean {
    return this.platform === "win32";
  }
}

/**
 * 运行态默认路径策略，所有 Backend / worker 文件 IO 共享同一平台判断。
 */
export const default_native_path_policy = new NativePathPolicy();
