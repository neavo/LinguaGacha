import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DesktopApiError, api_fetch } from "@/app/desktop-api";
import { createProjectPrefilterClient } from "@/app/project/derived/project-prefilter-client";
import { apply_project_prefilter_mutation } from "@/app/project/derived/project-prefilter-mutation";
import {
  normalize_settings_snapshot,
  type SettingsSnapshot,
  type SettingsSnapshotPayload,
} from "@/app/runtime/desktop/desktop-runtime-context";
import { useProjectPagesBarrier } from "@/app/runtime/project-pages/project-pages-context";
import { useDesktopRuntime } from "@/app/runtime/desktop/use-desktop-runtime";
import { useDesktopToast } from "@/app/runtime/toast/use-desktop-toast";
import { useI18n } from "@/i18n";
import { is_worker_client_error } from "@/lib/worker-client-error";
import {
  PROJECT_SAVE_MODE,
  REQUEST_TIMEOUT_MAX,
  REQUEST_TIMEOUT_MIN,
  build_basic_settings_snapshot,
  type BasicSettingsPendingField,
  type BasicSettingsSnapshot,
  type ProjectSaveMode,
  type SettingPendingState,
} from "@/pages/basic-settings-page/types";

type SettingsUpdateRequest = Record<string, unknown>;

type UseBasicSettingsStateResult = {
  snapshot: BasicSettingsSnapshot;
  pending_state: SettingPendingState;
  is_refreshing: boolean;
  is_task_busy: boolean;
  refresh_snapshot: () => Promise<void>;
  update_source_language: (next_language: string) => Promise<void>;
  update_target_language: (next_language: string) => Promise<void>;
  update_project_save_mode: (next_mode: ProjectSaveMode) => Promise<void>;
  update_output_folder_open_on_finish: (next_checked: boolean) => Promise<void>;
  update_request_timeout: (next_value: number) => Promise<void>;
};

function create_pending_state(): SettingPendingState {
  return {
    source_language: false,
    target_language: false,
    project_save_mode: false,
    output_folder_open_on_finish: false,
    request_timeout: false,
  };
}

function clamp_request_timeout(next_value: number): number {
  return Math.min(REQUEST_TIMEOUT_MAX, Math.max(REQUEST_TIMEOUT_MIN, next_value));
}

export function useBasicSettingsState(): UseBasicSettingsStateResult {
  const {
    settings_snapshot,
    task_snapshot,
    project_snapshot,
    project_store,
    set_settings_snapshot,
    commit_local_project_patch,
    refresh_project_runtime,
    align_project_runtime_ack,
    refresh_settings,
  } = useDesktopRuntime();
  const { create_barrier_checkpoint, wait_for_barrier } = useProjectPagesBarrier();
  const { push_toast, run_modal_progress_toast } = useDesktopToast();
  const { t } = useI18n();
  const [snapshot, set_snapshot] = useState<BasicSettingsSnapshot>(() => {
    return build_basic_settings_snapshot(settings_snapshot);
  });
  const [pending_state, set_pending_state] = useState<SettingPendingState>(() => {
    return create_pending_state();
  });
  const [is_refreshing, set_is_refreshing] = useState<boolean>(false);
  const snapshot_ref = useRef<BasicSettingsSnapshot>(snapshot);
  const settings_snapshot_ref = useRef<SettingsSnapshot>(settings_snapshot);
  const project_prefilter_client_ref = useRef(createProjectPrefilterClient());
  const context_snapshot = useMemo(() => {
    return build_basic_settings_snapshot(settings_snapshot);
  }, [settings_snapshot]);

  useEffect(() => {
    snapshot_ref.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    settings_snapshot_ref.current = settings_snapshot;
  }, [settings_snapshot]);

  useEffect(() => {
    set_snapshot(context_snapshot);
  }, [context_snapshot]);

  const is_task_busy = task_snapshot.busy;

  const set_pending = useCallback(
    (field: BasicSettingsPendingField, next_pending: boolean): void => {
      set_pending_state((previous_state) => {
        return {
          ...previous_state,
          [field]: next_pending,
        };
      });
    },
    [],
  );

  const refresh_snapshot = useCallback(async (): Promise<void> => {
    set_is_refreshing(true);

    try {
      const next_settings_snapshot = await refresh_settings();
      set_snapshot(build_basic_settings_snapshot(next_settings_snapshot));
    } catch (error) {
      push_toast(
        "error",
        error instanceof Error ? error.message : t("basic_settings_page.feedback.refresh_failed"),
      );
    } finally {
      set_is_refreshing(false);
    }
  }, [push_toast, refresh_settings, t]);

  useEffect(() => {
    void refresh_snapshot();
  }, [refresh_snapshot]);

  useEffect(() => {
    const project_prefilter_client = project_prefilter_client_ref.current;
    return () => {
      project_prefilter_client.dispose();
    };
  }, []);

  const commit_update = useCallback(
    async (
      field: BasicSettingsPendingField,
      request: SettingsUpdateRequest,
      next_snapshot: BasicSettingsSnapshot,
    ): Promise<SettingsSnapshot | null> => {
      const previous_snapshot = snapshot_ref.current;
      set_snapshot(next_snapshot);
      set_pending(field, true);

      try {
        const payload = await api_fetch<SettingsSnapshotPayload>("/api/settings/update", request);
        const next_settings_snapshot = normalize_settings_snapshot(payload);
        set_settings_snapshot(next_settings_snapshot);
        set_snapshot(build_basic_settings_snapshot(next_settings_snapshot));
        return next_settings_snapshot;
      } catch (error) {
        set_snapshot((current_snapshot) => {
          const reverted_snapshot = {
            ...current_snapshot,
          };

          if ("source_language" in request) {
            reverted_snapshot.source_language = previous_snapshot.source_language;
          }
          if ("target_language" in request) {
            reverted_snapshot.target_language = previous_snapshot.target_language;
          }
          if ("project_save_mode" in request) {
            reverted_snapshot.project_save_mode = previous_snapshot.project_save_mode;
          }
          if ("project_fixed_path" in request) {
            reverted_snapshot.project_fixed_path = previous_snapshot.project_fixed_path;
          }
          if ("output_folder_open_on_finish" in request) {
            reverted_snapshot.output_folder_open_on_finish =
              previous_snapshot.output_folder_open_on_finish;
          }
          if ("request_timeout" in request) {
            reverted_snapshot.request_timeout = previous_snapshot.request_timeout;
          }

          return reverted_snapshot;
        });

        if (error instanceof Error) {
          push_toast("error", error.message);
        } else {
          push_toast("error", t("basic_settings_page.feedback.update_failed"));
        }
        return null;
      } finally {
        set_pending(field, false);
      }
    },
    [push_toast, set_pending, set_settings_snapshot, t],
  );

  const sync_project_settings_meta = useCallback(
    async (next_settings_snapshot: SettingsSnapshot): Promise<void> => {
      if (!project_snapshot.loaded) {
        return;
      }

      await api_fetch("/api/project/settings/sync-meta", {
        source_language: next_settings_snapshot.source_language,
        target_language: next_settings_snapshot.target_language,
      });
    },
    [project_snapshot.loaded],
  );

  const apply_prefilter_from_settings = useCallback(
    async (next_settings_snapshot: SettingsSnapshot): Promise<void> => {
      if (!project_snapshot.loaded) {
        return;
      }

      await apply_project_prefilter_mutation({
        state: project_store.getState(),
        source_language: next_settings_snapshot.source_language,
        mtool_optimizer_enable: next_settings_snapshot.mtool_optimizer_enable,
        compute_prefilter: (input) => {
          return project_prefilter_client_ref.current.compute(input);
        },
        commit_local_project_patch,
        align_project_runtime_ack,
        refresh_project_runtime,
      });
    },
    [
      align_project_runtime_ack,
      commit_local_project_patch,
      project_snapshot.loaded,
      project_store,
      refresh_project_runtime,
    ],
  );

  const rollback_source_language_after_prefilter_error = useCallback(
    async (
      previous_snapshot: BasicSettingsSnapshot,
      previous_settings_snapshot: SettingsSnapshot,
    ): Promise<void> => {
      const rollback_settings_snapshot = await commit_update(
        "source_language",
        {
          source_language: previous_snapshot.source_language,
        },
        previous_snapshot,
      );
      if (rollback_settings_snapshot === null) {
        return;
      }

      try {
        await sync_project_settings_meta(previous_settings_snapshot);
      } catch (error) {
        if (error instanceof Error) {
          push_toast("error", error.message);
        } else {
          push_toast("error", t("basic_settings_page.feedback.update_failed"));
        }
        return;
      }

      push_toast("error", t("basic_settings_page.feedback.update_failed"));
    },
    [commit_update, push_toast, sync_project_settings_meta, t],
  );

  const update_source_language = useCallback(
    async (next_language: string): Promise<void> => {
      const previous_snapshot = snapshot_ref.current;
      const previous_settings_snapshot = settings_snapshot_ref.current;

      if (is_task_busy || previous_snapshot.source_language === next_language) {
        return;
      }

      const barrier_checkpoint = create_barrier_checkpoint();

      try {
        await run_modal_progress_toast({
          message: t("basic_settings_page.feedback.source_language_loading_toast"),
          task: async () => {
            const next_settings_snapshot = await commit_update(
              "source_language",
              {
                source_language: next_language,
              },
              {
                ...previous_snapshot,
                source_language: next_language,
              },
            );

            if (next_settings_snapshot === null) {
              return;
            }

            await sync_project_settings_meta(next_settings_snapshot);
            await apply_prefilter_from_settings(next_settings_snapshot);
            await wait_for_barrier("project_cache_refresh", {
              checkpoint: barrier_checkpoint,
            });
          },
        });
      } catch (error) {
        if (!is_worker_client_error(error)) {
          throw error;
        }

        await rollback_source_language_after_prefilter_error(
          previous_snapshot,
          previous_settings_snapshot,
        );
      }
    },
    [
      apply_prefilter_from_settings,
      commit_update,
      create_barrier_checkpoint,
      is_task_busy,
      rollback_source_language_after_prefilter_error,
      run_modal_progress_toast,
      sync_project_settings_meta,
      t,
      wait_for_barrier,
    ],
  );

  const update_target_language = useCallback(
    async (next_language: string): Promise<void> => {
      const previous_snapshot = snapshot_ref.current;

      if (is_task_busy || previous_snapshot.target_language === next_language) {
        return;
      }

      const next_settings_snapshot = await commit_update(
        "target_language",
        {
          target_language: next_language,
        },
        {
          ...previous_snapshot,
          target_language: next_language,
        },
      );
      if (next_settings_snapshot === null) {
        return;
      }
      await sync_project_settings_meta(next_settings_snapshot);
    },
    [commit_update, is_task_busy, sync_project_settings_meta],
  );

  const update_project_save_mode = useCallback(
    async (next_mode: ProjectSaveMode): Promise<void> => {
      const previous_snapshot = snapshot_ref.current;

      if (previous_snapshot.project_save_mode === next_mode) {
        return;
      }

      if (next_mode === PROJECT_SAVE_MODE.FIXED) {
        try {
          const result = await window.desktopApp.pickFixedProjectDirectory(
            previous_snapshot.project_fixed_path,
          );
          if (result.canceled || result.path === null || result.path === "") {
            return;
          }

          await commit_update(
            "project_save_mode",
            {
              project_save_mode: next_mode,
              project_fixed_path: result.path,
            },
            {
              ...previous_snapshot,
              project_save_mode: next_mode,
              project_fixed_path: result.path,
            },
          );
        } catch (error) {
          if (error instanceof DesktopApiError) {
            push_toast("error", error.message);
          } else {
            push_toast("error", t("basic_settings_page.feedback.pick_directory_failed"));
          }
        }
      } else {
        await commit_update(
          "project_save_mode",
          {
            project_save_mode: next_mode,
          },
          {
            ...previous_snapshot,
            project_save_mode: next_mode,
          },
        );
      }
    },
    [commit_update, push_toast, t],
  );

  const update_output_folder_open_on_finish = useCallback(
    async (next_checked: boolean): Promise<void> => {
      const previous_snapshot = snapshot_ref.current;

      if (previous_snapshot.output_folder_open_on_finish === next_checked) {
        return;
      }

      await commit_update(
        "output_folder_open_on_finish",
        {
          output_folder_open_on_finish: next_checked,
        },
        {
          ...previous_snapshot,
          output_folder_open_on_finish: next_checked,
        },
      );
    },
    [commit_update],
  );

  const update_request_timeout = useCallback(
    async (next_value: number): Promise<void> => {
      const previous_snapshot = snapshot_ref.current;
      const normalized_timeout = clamp_request_timeout(next_value);

      if (
        Number.isNaN(normalized_timeout) ||
        previous_snapshot.request_timeout === normalized_timeout
      ) {
        return;
      }

      await commit_update(
        "request_timeout",
        {
          request_timeout: normalized_timeout,
        },
        {
          ...previous_snapshot,
          request_timeout: normalized_timeout,
        },
      );
    },
    [commit_update],
  );

  const value = useMemo<UseBasicSettingsStateResult>(() => {
    return {
      snapshot,
      pending_state,
      is_refreshing,
      is_task_busy,
      refresh_snapshot,
      update_source_language,
      update_target_language,
      update_project_save_mode,
      update_output_folder_open_on_finish,
      update_request_timeout,
    };
  }, [
    is_refreshing,
    is_task_busy,
    pending_state,
    refresh_snapshot,
    snapshot,
    update_output_folder_open_on_finish,
    update_project_save_mode,
    update_request_timeout,
    update_source_language,
    update_target_language,
  ]);

  return value;
}
