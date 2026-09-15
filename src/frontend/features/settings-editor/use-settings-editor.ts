import { useCallback, useEffect, useRef, useState } from "react";

import { PROJECT_SETTING_KEYS } from "@domain/setting";
import type { ProjectWriteResultPayload } from "@frontend/app/state/desktop-project-write";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import type {
  SettingsSnapshot,
  SettingsSnapshotPayload,
} from "@frontend/app/state/desktop-state-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";

type SettingsEditorOptions<
  Snapshot extends object,
  PendingField extends Extract<keyof Snapshot, string>,
> = {
  select_snapshot: (settings_snapshot: SettingsSnapshot) => Snapshot;
  pending_fields: readonly PendingField[];
  refresh_error_key: LocaleKey;
  update_error_key: LocaleKey;
};

/**
 * 从页面声明的字段集合生成完整 pending 形状，避免各设置页重复维护默认对象。
 */
function create_pending_state<PendingField extends string>(
  fields: readonly PendingField[],
): Record<PendingField, boolean> {
  return Object.fromEntries(fields.map((field) => [field, false])) as Record<PendingField, boolean>;
}

/**
 * 统一拥有设置页的刷新、乐观更新、字段级 pending 与失败回滚。
 */
export function useSettingsEditor<
  Snapshot extends object,
  PendingField extends Extract<keyof Snapshot, string>,
>(
  options: SettingsEditorOptions<Snapshot, PendingField>,
): {
  snapshot: Snapshot;
  pending_state: Record<PendingField, boolean>;
  commit_update: (
    field: PendingField,
    patch: Partial<Snapshot>,
  ) => Promise<SettingsSnapshot | null>;
} {
  const { settings_snapshot, apply_settings_snapshot, refresh_settings, commit_project_write } =
    useDesktopState();
  const { push_toast } = useDesktopToast();
  const { t } = useI18n();
  const [snapshot, set_snapshot] = useState(() => options.select_snapshot(settings_snapshot));
  const [pending_state, set_pending_state] = useState(() =>
    create_pending_state(options.pending_fields),
  );
  const snapshot_ref = useRef(snapshot);

  const sync_snapshot = useCallback(
    (next_settings_snapshot: SettingsSnapshot): void => {
      const next_snapshot = options.select_snapshot(next_settings_snapshot);
      snapshot_ref.current = next_snapshot;
      set_snapshot(next_snapshot);
    },
    [options.select_snapshot],
  );

  useEffect(() => {
    sync_snapshot(settings_snapshot);
  }, [settings_snapshot, sync_snapshot]);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        sync_snapshot(await refresh_settings());
      } catch (error) {
        push_toast("error", resolve_visible_error_message(error, t, t(options.refresh_error_key)));
      }
    })();
  }, [options.refresh_error_key, push_toast, refresh_settings, sync_snapshot, t]);

  const commit_update = useCallback(
    async (field: PendingField, patch: Partial<Snapshot>): Promise<SettingsSnapshot | null> => {
      const previous_snapshot = snapshot_ref.current;
      const optimistic_snapshot = {
        ...previous_snapshot,
        ...patch,
      };
      // ref 始终指向最新乐观快照，失败请求只回滚自己的字段，不抹掉其它并发字段。
      snapshot_ref.current = optimistic_snapshot;
      set_snapshot(optimistic_snapshot);
      set_pending_state((previous_state) => ({
        ...previous_state,
        [field]: true,
      }));

      const affects_project = PROJECT_SETTING_KEYS.some((key) => Object.hasOwn(patch, key));
      try {
        const run = () =>
          api_fetch<SettingsSnapshotPayload & ProjectWriteResultPayload>(
            "/api/settings/update",
            patch as Record<string, unknown>,
          );
        const payload = affects_project
          ? (await commit_project_write({ operation: "settings.update", run })).payload
          : await run();
        const next_settings_snapshot = apply_settings_snapshot(payload);
        sync_snapshot(next_settings_snapshot);
        return next_settings_snapshot;
      } catch (error) {
        // 工程可能已提交；优先恢复权威值，查询失败时使用提交前值，始终只替换本次字段。
        let restored = previous_snapshot;
        if (affects_project) {
          try {
            restored = options.select_snapshot(await refresh_settings());
          } catch (refresh_error) {
            push_toast(
              "error",
              resolve_visible_error_message(refresh_error, t, t(options.refresh_error_key)),
            );
          }
        }
        const restored_patch = Object.fromEntries(
          Object.keys(patch).map((key) => [key, restored[key as keyof Snapshot]]),
        );
        snapshot_ref.current = { ...snapshot_ref.current, ...restored_patch };
        set_snapshot(snapshot_ref.current);
        push_toast("error", resolve_visible_error_message(error, t, t(options.update_error_key)));
        return null;
      } finally {
        set_pending_state((previous_state) => ({
          ...previous_state,
          [field]: false,
        }));
      }
    },
    [
      apply_settings_snapshot,
      commit_project_write,
      options.update_error_key,
      options.refresh_error_key,
      options.select_snapshot,
      push_toast,
      refresh_settings,
      sync_snapshot,
      t,
    ],
  );

  return {
    snapshot,
    pending_state,
    commit_update,
  };
}
