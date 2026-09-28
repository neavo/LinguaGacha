import type { SettingSnapshot } from "../domain/setting";
import type { ProjectWriteResult } from "./project-event";

export type SettingsSnapshotResponse = { settings: SettingSnapshot };
/** 配置与工程同步完成后返回同一设置快照及工程提交回执。 */
export type SettingsUpdateResponse = SettingsSnapshotResponse & ProjectWriteResult;
