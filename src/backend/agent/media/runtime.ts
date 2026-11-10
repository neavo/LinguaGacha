export type MediaConfiguration = Readonly<{
  modelsDirectory: string;
  cacheDirectory: string;
  runtimeDirectory: string;
}>;

let configuration: MediaConfiguration | undefined; // 仅根脚本绑定，后代进程保持未绑定状态。

/** 绑定宿主解析的路径。SDK 与 bootstrap 通过共享 chunk 消费同一实例。 */
export function bind_media(value: MediaConfiguration): void {
  if (configuration) throw new Error("Media workspace runtime is already bound.");
  configuration = Object.freeze({ ...value });
}

/** 拒绝未绑定进程，避免后代自行准备共享媒体资源。 */
export function media_configuration(): MediaConfiguration {
  if (!configuration) throw new Error("Current process is not bound to a workspace runtime.");
  return configuration;
}
