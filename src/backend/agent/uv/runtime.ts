import type { UvConfiguration } from "./types";

// 共享工程种子要求的 CPython 次版本，取发版时的次新版本，兼顾三方 wheel 覆盖与 bugfix 支持期。
// 新次版本发布后人工更新。种子只写入一次，已有工程的版本归用户管理。
export const DEFAULT_PYTHON_VERSION = "3.14";

// 自动默认源只设置 Python 包索引，解释器下载不受影响。地区判定见 `package-source`。
export const UV_INDEXES = Object.freeze({
  official: "https://pypi.org/simple",
  mirror: "https://pypi.tuna.tsinghua.edu.cn/simple",
});

let configuration: UvConfiguration | undefined; // 每次根脚本启动时绑定，后代进程没有该绑定。

/** 只由根进程 bootstrap 绑定，共享 chunk 保证公共入口消费同一实例。 */
export function bind_uv(value: UvConfiguration): void {
  if (configuration) throw new Error("uv workspace runtime is already bound.");
  configuration = Object.freeze({ ...value });
}

/** 拒绝未绑定的后代，避免它们另建队列并发修改共享工程。 */
export function uv_configuration(): UvConfiguration {
  if (!configuration) throw new Error("Current process is not bound to a workspace runtime.");
  return configuration;
}
