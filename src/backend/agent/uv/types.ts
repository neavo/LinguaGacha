/** 宿主经 IPC 交给根脚本的 Python 数据根与随附 uv 路径。 */
export type UvConfiguration = Readonly<{ pythonRoot: string; uvExecutable: string }>;

/** 应用随附 uv 的工作区入口，调用固定在共享 Python 工程中执行。 */
export interface UvApi {
  readonly directory: string; // 跨工程、跨对话共享的 uv 工程绝对路径。
  run(args: readonly string[]): Promise<void>; // 参数直接作为 argv，输出进入工作区日志，非零退出抛错。
}
