/** 应用随附 npm 的工作区入口，调用固定在共享 npm 工程中执行。 */
export interface NpmApi {
  readonly directory: string; // 跨工程、跨对话共享的 npm 工程绝对路径。
  run(args: readonly string[]): Promise<void>; // 参数直接作为 argv，输出进入工作区日志，非零退出抛错。
}
