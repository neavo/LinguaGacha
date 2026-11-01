export type PythonInfo = Readonly<{ version: string; executable: string; directory: string }>;
export type PythonInstallation = Readonly<{ version: string; executable: string }>;
/** 句柄绑定次版本，异步操作共享根进程的执行队列。 */
export interface PythonEnvironment {
  ensure(): Promise<void>; // 按当前声明恢复可运行环境。
  upgrade(): Promise<void>; // 显式升级补丁，复用健康安装树。
  info(): Promise<PythonInfo>; // 查询实际版本，未完成的环境拒绝返回就绪信息。
  // 显式修改先修正声明，旧依赖不可解析时也能进入恢复流程。
  install(requirements: readonly string[]): Promise<void>;
  remove(packages: readonly string[]): Promise<void>;
  run(args: readonly string[]): Promise<void>; // 准备后运行，程序输出进入当前工具日志。
}
/** 同步选取句柄不执行 IO，使损坏环境保留修复入口。 */
export interface PythonApi {
  environment(options?: Readonly<{ version?: string }>): PythonEnvironment;
  list(): Promise<readonly PythonInstallation[]>; // 只查询应用管理目录中的已安装解释器。
}
