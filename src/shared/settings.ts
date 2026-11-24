import type { SettingSnapshot } from "../domain/setting";
import type { ProjectWriteResult } from "./project-event";

export type SettingsSnapshotResponse = { settings: SettingSnapshot };
export type SettingsUpdateResponse = SettingsSnapshotResponse & ProjectWriteResult;
