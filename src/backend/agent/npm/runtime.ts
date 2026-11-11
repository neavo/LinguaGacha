export type NpmConfiguration = Readonly<{ runtimeDirectory: string; nodeRoot: string }>; // 应用运行目录与共享 npm 工程。

// 自动默认源只替换 npm 内建的 registry 默认值，地区判定见 `package-source`。
export const NPM_REGISTRIES = Object.freeze({
  official: "https://registry.npmjs.org/",
  mirror: "https://registry.npmmirror.com/",
});

let configuration: NpmConfiguration | undefined; // 每次根脚本启动时绑定，后代进程没有该绑定。

/** 只由根进程 bootstrap 绑定，共享 chunk 保证公共入口消费同一实例。 */
export function bind_npm(value: NpmConfiguration): void {
  if (configuration) throw new Error("npm workspace runtime is already bound.");
  configuration = Object.freeze({ ...value });
}

/** 拒绝未绑定的后代，避免它们另建队列并发修改共享工程。 */
export function npm_configuration(): NpmConfiguration {
  if (!configuration) throw new Error("Current process is not bound to a workspace runtime.");
  return configuration;
}
