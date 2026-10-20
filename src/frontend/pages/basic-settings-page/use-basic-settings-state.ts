import {
  push_error_toast,
  push_toast,
  run_modal_progress_toast,
} from "@frontend/app/feedback/desktop-toast";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_PROJECT_LANGUAGE_SETTINGS,
  type ProjectLanguageKey,
} from "@domain/project-settings";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type { ProjectWriteResultPayload } from "@frontend/app/state/desktop-project-write";

import { format_project_settings_aligned_toast } from "@frontend/app/feedback/project-settings-alignment-feedback";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import { useSettingsEditor } from "@frontend/features/settings-editor/use-settings-editor";
import { is_same_proxy_setting } from "@domain/setting";
import type { AppSettingsResponse } from "@shared/settings";
import type { AppProxyRuntimeStatus, ProxyProbeSummary } from "@shared/proxy";
import {
  REQUEST_TIMEOUT_MAX,
  REQUEST_TIMEOUT_MIN,
  build_basic_settings_snapshot,
  type BasicSettingsSnapshot,
  type ProjectSaveMode,
  type ProxySettingValue,
} from "@frontend/pages/basic-settings-page/types";

const BASIC_SETTINGS_PENDING_FIELDS = [
  "project_save_mode",
  "output_folder_open_on_finish",
  "request_timeout",
  "proxy",
] as const;

const PROJECT_SETTINGS_UPDATE_OPERATION = "project.settings.update";
const IDLE_LANGUAGE_PENDING_STATE: Readonly<Record<ProjectLanguageKey, boolean>> = {
  source_language: false,
  target_language: false,
};

type UseBasicSettingsStateResult = {
  snapshot: BasicSettingsSnapshot;
  pending_state: Record<(typeof BASIC_SETTINGS_PENDING_FIELDS)[number], boolean>;
  languages: Record<ProjectLanguageKey, string>; // 当前项目语言，保存期间显示本次选择
  language_pending_state: Record<ProjectLanguageKey, boolean>;
  language_locked: boolean; // 未加载项目或运行中时不可修改项目语言
  runtime_locked: boolean;
  proxy_status: AppProxyRuntimeStatus | null; // 首次读取完成前不提示降级
  proxy_probe: ProxyProbeSummary | null;
  is_probing_proxy: boolean;
  update_source_language: (next_language: string) => Promise<void>;
  update_target_language: (next_language: string) => Promise<void>;
  update_project_save_mode: (next_mode: ProjectSaveMode) => Promise<void>;
  update_output_folder_open_on_finish: (next_checked: boolean) => Promise<void>;
  update_request_timeout: (next_value: number) => Promise<void>;
  save_proxy: (next_value: ProxySettingValue) => Promise<ProxySettingValue | null>;
  probe_proxy: () => Promise<void>;
};

/**
 * 输入框值在页面边界收敛到后端设置允许的区间。
 */
function clamp_request_timeout(next_value: number): number {
  return Math.min(REQUEST_TIMEOUT_MAX, Math.max(REQUEST_TIMEOUT_MIN, next_value));
}

/**
 * 组合应用设置编辑器与项目语言写入，页面不直接拥有后端设置事实。
 */
export function useBasicSettingsState(): UseBasicSettingsStateResult {
  const { project_snapshot, commit_project_write } = useDesktopState();
  const runtime_snapshot = useRuntimeSnapshot();

  const { t } = useI18n();
  const { snapshot, pending_state, commit_update } = useSettingsEditor({
    select_snapshot: build_basic_settings_snapshot,
    pending_fields: BASIC_SETTINGS_PENDING_FIELDS,
  });
  const runtime_locked = project_snapshot.loaded && is_runtime_busy(runtime_snapshot);
  const language_locked = !project_snapshot.loaded || runtime_locked;

  // 代理下发状态只属于运行期，随设置读取响应返回；保存响应不带该状态，成功后重新读取。
  const [proxy_status, set_proxy_status] = useState<AppProxyRuntimeStatus | null>(null);
  const [proxy_probe, set_proxy_probe] = useState<ProxyProbeSummary | null>(null);
  const [is_probing_proxy, set_is_probing_proxy] = useState(false);
  const proxy_probe_generation = useRef(0); // 配置变化后丢弃旧探测结果
  const last_probed_proxy = useRef(snapshot.proxy);

  // 已保存配置变化（保存或外部刷新）时，旧配置的测试结果不再可信。
  useEffect(() => {
    if (is_same_proxy_setting(last_probed_proxy.current, snapshot.proxy)) return;
    last_probed_proxy.current = snapshot.proxy;
    proxy_probe_generation.current += 1;
    set_proxy_probe(null);
  }, [snapshot.proxy]);

  const refresh_proxy_status = useCallback(async (): Promise<void> => {
    try {
      const payload = await api_fetch<AppSettingsResponse>("/api/settings/app", {});
      set_proxy_status(payload.proxyStatus);
    } catch (error) {
      push_error_toast(t("app.feedback.refresh_failed"), error);
    }
  }, [t]);

  useEffect(() => {
    void refresh_proxy_status();
  }, [refresh_proxy_status]);

  // 保存期间由字段草稿覆盖项目快照，成功或失败恢复后交回已提交事实。
  const [language_draft, set_language_draft] = useState<
    Partial<Record<ProjectLanguageKey, string>>
  >({});
  const [language_pending_state, set_language_pending_state] = useState<
    Record<ProjectLanguageKey, boolean>
  >(IDLE_LANGUAGE_PENDING_STATE);
  const languages = useMemo<Record<ProjectLanguageKey, string>>(
    () => ({
      ...(project_snapshot.languages ?? DEFAULT_PROJECT_LANGUAGE_SETTINGS),
      ...language_draft,
    }),
    [language_draft, project_snapshot.languages],
  );

  const update_language = useCallback(
    async (field: ProjectLanguageKey, next_language: string): Promise<void> => {
      if (language_locked || languages[field] === next_language) return;
      const save = async (): Promise<void> => {
        set_language_draft((previous) => ({ ...previous, [field]: next_language }));
        set_language_pending_state((previous) => ({ ...previous, [field]: true }));
        try {
          await commit_project_write({
            operation: PROJECT_SETTINGS_UPDATE_OPERATION,
            run: () =>
              api_fetch<ProjectWriteResultPayload>("/api/project/settings/update", {
                [field]: next_language,
              }),
          });
          push_toast(
            "info",
            format_project_settings_aligned_toast({
              settings: { [field]: next_language },
              changed_fields: { [field]: true },
              t,
            }),
          );
        } catch (error) {
          push_error_toast(t("app.feedback.save_failed"), error);
        } finally {
          set_language_draft((previous) => {
            const next = { ...previous };
            delete next[field];
            return next;
          });
          set_language_pending_state((previous) => ({ ...previous, [field]: false }));
        }
      };
      if (field === "source_language") {
        await run_modal_progress_toast({
          message: t("app.feedback.project_cache_loading"),
          task: save,
        });
      } else {
        await save();
      }
    },
    [commit_project_write, language_locked, languages, t],
  );

  const update_project_save_mode = useCallback(
    async (next_mode: ProjectSaveMode): Promise<void> => {
      if (snapshot.project_save_mode === next_mode) {
        return;
      }

      if (next_mode === "FIXED") {
        try {
          const result = await window.desktopApp.pickFixedProjectDirectory(
            snapshot.project_fixed_path,
          );
          const selected_path = result.paths[0] ?? "";
          if (result.canceled || selected_path === "") {
            return;
          }

          await commit_update("project_save_mode", {
            project_save_mode: next_mode,
            project_fixed_path: selected_path,
          });
        } catch (error) {
          push_error_toast(t("basic_settings_page.feedback.pick_directory_failed"), error);
        }
        return;
      }

      await commit_update("project_save_mode", {
        project_save_mode: next_mode,
      });
    },
    [commit_update, snapshot.project_fixed_path, snapshot.project_save_mode, t],
  );

  const update_output_folder_open_on_finish = useCallback(
    async (next_checked: boolean): Promise<void> => {
      if (snapshot.output_folder_open_on_finish === next_checked) {
        return;
      }

      await commit_update("output_folder_open_on_finish", {
        output_folder_open_on_finish: next_checked,
      });
    },
    [commit_update, snapshot.output_folder_open_on_finish],
  );

  const update_request_timeout = useCallback(
    async (next_value: number): Promise<void> => {
      const normalized_timeout = clamp_request_timeout(next_value);
      if (Number.isNaN(normalized_timeout) || snapshot.request_timeout === normalized_timeout) {
        return;
      }

      await commit_update("request_timeout", {
        request_timeout: normalized_timeout,
      });
    },
    [commit_update, snapshot.request_timeout],
  );

  /** 代理配置整体提交；保存成功返回后端归一后的配置，页面据此同步草稿。 */
  const save_proxy = useCallback(
    async (next_value: ProxySettingValue): Promise<ProxySettingValue | null> => {
      const settings = await commit_update("proxy", { proxy: next_value });
      if (settings === null) return null;
      await refresh_proxy_status();
      return settings.proxy;
    },
    [commit_update, refresh_proxy_status],
  );

  /** 测试连接只读取已保存配置；配置在探测期间变化时丢弃这次结果。 */
  const probe_proxy = useCallback(async (): Promise<void> => {
    const generation = proxy_probe_generation.current;
    set_is_probing_proxy(true);
    try {
      const summary = await api_fetch<ProxyProbeSummary>("/api/settings/proxy/probe", {});
      if (proxy_probe_generation.current === generation) set_proxy_probe(summary);
    } catch (error) {
      push_error_toast(t("basic_settings_page.feedback.proxy_test_failed"), error);
    } finally {
      set_is_probing_proxy(false);
    }
  }, [t]);

  return {
    snapshot,
    pending_state,
    languages,
    language_pending_state,
    language_locked,
    runtime_locked,
    proxy_status,
    proxy_probe,
    is_probing_proxy,
    update_source_language: (value) => update_language("source_language", value),
    update_target_language: (value) => update_language("target_language", value),
    update_project_save_mode,
    update_output_folder_open_on_finish,
    update_request_timeout,
    save_proxy,
    probe_proxy,
  };
}
