import type { SettingSnapshot } from "../domain/setting";
import type { AppProxyRuntimeStatus } from "./proxy";
import type { ProjectWriteResult } from "./project-event";

export type SettingsSnapshotResponse = { settings: SettingSnapshot };
/** 设置读取响应附带出站代理的下发状态；状态属于运行期事实，不进入设置文件。 */
export type AppSettingsResponse = SettingsSnapshotResponse & {
  proxyStatus: AppProxyRuntimeStatus;
};
/** 配置与工程同步完成后返回同一设置快照及工程提交回执。 */
export type SettingsUpdateResponse = SettingsSnapshotResponse & ProjectWriteResult;
