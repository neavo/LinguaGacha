export type InferenceConfiguration = Readonly<{
  modelsDirectory: string;
  cacheDirectory: string;
  runtimeDirectory: string;
}>;

let configuration: InferenceConfiguration | undefined; // 仅根脚本绑定，后代进程保持未绑定状态。

/** 绑定宿主解析的路径。SDK 与 bootstrap 通过共享 chunk 消费同一实例。 */
export function bind_inference(value: InferenceConfiguration): void {
  if (configuration) throw new Error("Inference workspace runtime is already bound.");
  configuration = Object.freeze({ ...value });
}

/** 拒绝未绑定进程，避免后代自行准备共享推理资源。 */
export function inference_configuration(): InferenceConfiguration {
  if (!configuration) throw new Error("Current process is not bound to a workspace runtime.");
  return configuration;
}

let gpu_pending: Promise<unknown> = Promise.resolve(); // 两个 SDK 共用队尾，覆盖原生资源收尾。
let shutdown_failure: Error | undefined; // 无法确认资源已退出时，本次脚本停止创建推理资源。

/** CPU 可并行，GPU 操作在前一操作完成收尾后才启动。 */
export function run_inference_operation<T>(
  device: "cpu" | "gpu",
  action: () => Promise<T>,
): Promise<T> {
  const run = async () => {
    if (shutdown_failure) throw shutdown_failure;
    return await action();
  };
  if (device === "cpu") return run();
  const result = gpu_pending.then(run);
  gpu_pending = result.catch(() => undefined); // 调用者接收错误，队尾只记录收尾顺序。
  return result;
}

/** 关闭失败同时阻止图片和媒体续跑，避免旧 Worker 与新操作争用。 */
export async function close_inference(resource: { close(): Promise<void> }): Promise<void> {
  try {
    await resource.close();
  } catch (cause) {
    shutdown_failure = new Error(
      "Inference resources could not close; the host must end this run.",
      { cause },
    );
    throw shutdown_failure;
  }
}
