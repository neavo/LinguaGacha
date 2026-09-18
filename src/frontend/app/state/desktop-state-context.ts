import { createContext } from "react";
import type { RouteId } from "@frontend/app/navigation/types";
import type { ProjectStage } from "@frontend/app/state/desktop-project-change-types";
import type { createBatchTranslationSnapshotStore } from "@frontend/app/state/batch-translation-snapshot-store";
import type { BatchTranslationSnapshot } from "@domain/batch-translation";
import type { createRuntimeActivityStore } from "@frontend/app/state/runtime-activity-store";
import type { ProjectWriteCommitter } from "@frontend/app/state/desktop-project-write";
import type { RecentProjectSetting, SettingSnapshot } from "@domain/setting";
import type { AppLanguage } from "@domain/app-language";
import type { RuntimeActivitySnapshot } from "@shared/runtime-activity";
import type { createProjectChangeSignalStore } from "@frontend/app/state/project-change-signal-store";

type RecentProjectEntry = RecentProjectSetting;

export type SettingsSnapshot = SettingSnapshot;

export type ProjectSnapshot = {
  path: string;
  loaded: boolean;
};

export type ProjectSessionStatus = "idle" | "warming" | "ready";

export type DesktopStateContextValue = {
  initial_state_status: "loading" | "ready" | "error";
  load_initial_state: () => Promise<void>;
  settings_snapshot: SettingsSnapshot;
  project_snapshot: ProjectSnapshot;
  project_session_status: ProjectSessionStatus;
  project_session_stage: ProjectStage | null;
  pending_target_route: RouteId | null;
  is_app_language_updating: boolean;
  set_project_session_status: (status: ProjectSessionStatus) => void;
  set_pending_target_route: (route_id: RouteId | null) => void;
  apply_settings_snapshot: (payload: SettingsSnapshotPayload) => SettingsSnapshot;
  refresh_project_snapshot: () => Promise<ProjectSnapshot>;
  refresh_project_state: () => Promise<void>;
  commit_project_write: ProjectWriteCommitter;
  update_app_language: (language: AppLanguage) => Promise<SettingsSnapshot>;
  refresh_settings: () => Promise<SettingsSnapshot>;
  refresh_batch_translation: () => Promise<BatchTranslationSnapshot>;
  refresh_runtime: () => Promise<RuntimeActivitySnapshot>;
};

export type SettingsSnapshotPayload = {
  settings?: Partial<SettingsSnapshot> & {
    recent_projects?: Array<Partial<RecentProjectEntry>>;
  };
};

// Desktop Runtime Context 是模块级稳定契约，集中维护避免调用点散落魔术值。
export const DesktopStateContext = createContext<DesktopStateContextValue | null>(null);
export type DesktopStateStores = {
  batch_translation: ReturnType<typeof createBatchTranslationSnapshotStore>;
  runtime: ReturnType<typeof createRuntimeActivityStore>;
  projectChange: ReturnType<typeof createProjectChangeSignalStore>;
};
export const DesktopStateStoresContext = createContext<DesktopStateStores | null>(null);
