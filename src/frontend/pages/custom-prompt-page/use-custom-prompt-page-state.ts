import { TRANSLATION_PROMPT } from "@domain/prompt";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type { SettingsSnapshotPayload } from "@frontend/app/state/desktop-state-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  build_user_preset_virtual_id,
  create_empty_preset_input_state,
  decorate_preset_items,
  has_casefold_duplicate_preset,
  normalize_preset_name,
} from "@frontend/features/preset-editor/preset-model";
import type {
  PresetInputState as CustomPromptPresetInputState,
  PresetItem as CustomPromptPresetItem,
} from "@frontend/features/preset-editor/preset-types";
import { useCustomPromptEditorState } from "@frontend/pages/custom-prompt-page/use-custom-prompt-editor-state";
import type {
  CustomPromptConfirmState,
  UseCustomPromptPageStateResult,
} from "@frontend/pages/custom-prompt-page/types";

type PromptPresetPayload = {
  builtin_presets?: CustomPromptPresetItem[];
  user_presets?: CustomPromptPresetItem[];
};

type PromptImportPayload = {
  text?: string;
};

// 关闭态被冻结后可安全复用，打开态始终创建新对象。
const CLOSED_CONFIRM_STATE = Object.freeze({ kind: null } as const);

/**
 * 拥有自定义提示词的预设菜单、确认流程与导入导出状态。
 */
export function useCustomPromptPageState(): UseCustomPromptPageStateResult {
  const {
    template,
    prompt_text,
    enabled,
    readonly,
    update_prompt_text,
    update_enabled,
    replace_prompt_text,
    flush_prompt_change,
    load_status,
    reload_prompt,
  } = useCustomPromptEditorState();
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const { project_snapshot, settings_snapshot, apply_settings_snapshot } = useDesktopState();
  const [preset_snapshot, set_preset_snapshot] = useState<PromptPresetPayload>({
    builtin_presets: [],
    user_presets: [],
  });
  const preset_items = useMemo(
    () =>
      decorate_preset_items(
        preset_snapshot.builtin_presets ?? [],
        preset_snapshot.user_presets ?? [],
        String(settings_snapshot[TRANSLATION_PROMPT.default_preset_setting_key] ?? ""),
      ),
    [preset_snapshot, settings_snapshot],
  );
  const [preset_menu_open, set_preset_menu_open] = useState(false);
  const [confirm_state, set_confirm_state] =
    useState<CustomPromptConfirmState>(CLOSED_CONFIRM_STATE);
  const [preset_input_state, set_preset_input_state] = useState<CustomPromptPresetInputState>(
    () => {
      return create_empty_preset_input_state();
    },
  );
  useEffect(() => {
    if (!project_snapshot.loaded) {
      set_preset_snapshot({ builtin_presets: [], user_presets: [] });
      set_preset_menu_open(false);
      set_confirm_state(CLOSED_CONFIRM_STATE);
      set_preset_input_state(create_empty_preset_input_state());
    }
  }, [project_snapshot.loaded, project_snapshot.path]);

  /** 刷新预设条目，默认标记由当前设置计算。 */
  const refresh_preset_menu = useCallback(async (): Promise<void> => {
    const preset_payload = await api_fetch<PromptPresetPayload>("/api/quality/prompts/presets", {});
    set_preset_snapshot(preset_payload);
  }, []);

  /** 读取选中的文件并通过编辑器提交正文。 */
  const import_prompt_from_picker = useCallback(async (): Promise<void> => {
    if (readonly) {
      return;
    }

    try {
      const pick_result = await window.desktopApp.pickPromptImportFilePath();
      const selected_path = pick_result.paths[0] ?? null;
      if (pick_result.canceled || selected_path === null) {
        return;
      }

      const payload = await api_fetch<PromptImportPayload>("/api/quality/prompts/import", {
        path: selected_path,
      });
      if (await replace_prompt_text(String(payload.text ?? ""))) {
        push_toast("success", t("app.feedback.import_success"));
      }
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.import_failed")),
      );
    }
  }, [replace_prompt_text, push_toast, readonly, t]);

  /** 先等待草稿保存，再导出后端已确认的正文。 */
  const export_prompt_from_picker = useCallback(async (): Promise<void> => {
    try {
      const pick_result = await window.desktopApp.pickPromptExportFilePath();
      const selected_path = pick_result.paths[0] ?? null;
      if (pick_result.canceled || selected_path === null) {
        return;
      }

      if (!(await flush_prompt_change())) {
        return;
      }

      await api_fetch("/api/quality/prompts/export", {
        path: selected_path,
      });
      push_toast("success", t("app.feedback.export_success"));
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.export_failed")),
      );
    }
  }, [flush_prompt_change, push_toast, t]);

  /** 菜单打开时读取当前可用预设。 */
  const open_preset_menu = useCallback(async (): Promise<void> => {
    try {
      await refresh_preset_menu();
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.preset_failed")),
      );
    }
  }, [push_toast, refresh_preset_menu, t]);

  /** 提交所选预设，成功后关闭菜单。 */
  const apply_preset = useCallback(
    async (virtual_id: string): Promise<void> => {
      if (readonly) {
        return;
      }

      try {
        const payload = await api_fetch<{ text?: string }>("/api/quality/prompts/presets/read", {
          virtual_id,
        });
        const succeeded = await replace_prompt_text(String(payload.text ?? ""));
        if (succeeded) {
          set_preset_menu_open(false);
        }
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.preset_failed")),
        );
      }
    },
    [replace_prompt_text, push_toast, readonly, t],
  );

  /** 重置正文前记录待确认操作。 */
  const request_reset_prompt = useCallback((): void => {
    if (readonly) {
      return;
    }

    set_confirm_state({
      kind: "reset",
      submitting: false,
    });
  }, [readonly]);

  /** 为当前内容打开预设命名流程。 */
  const request_save_preset = useCallback((): void => {
    if (readonly) {
      return;
    }

    set_preset_input_state({
      open: true,
      mode: "save",
      value: "",
      submitting: false,
      target_virtual_id: null,
    });
  }, [readonly]);

  /** 记录预设身份和当前名称供重命名。 */
  const request_rename_preset = useCallback(
    (preset_item: CustomPromptPresetItem): void => {
      if (readonly) {
        return;
      }

      set_preset_input_state({
        open: true,
        mode: "rename",
        value: preset_item.name,
        submitting: false,
        target_virtual_id: preset_item.virtual_id,
      });
    },
    [readonly],
  );

  /** 删除确认只保存目标身份。 */
  const request_delete_preset = useCallback(
    (preset_item: CustomPromptPresetItem): void => {
      if (readonly) {
        return;
      }

      set_confirm_state({
        kind: "delete-preset",
        submitting: false,
        target_virtual_id: preset_item.virtual_id,
      });
    },
    [readonly],
  );

  /** 校验名称并写入当前内容，完成后刷新预设列表。 */
  const save_preset = useCallback(
    async (name: string): Promise<boolean> => {
      if (readonly) {
        return false;
      }

      const normalized_name = normalize_preset_name(name);
      if (normalized_name === "") {
        push_toast("warning", t("preset_editor.feedback.name_required"));
        return false;
      }

      try {
        await api_fetch("/api/quality/prompts/presets/save", {
          name: normalized_name,
          text: prompt_text.trim(),
        });
        await refresh_preset_menu();
        return true;
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.preset_failed")),
        );
        return false;
      }
    },
    [prompt_text, push_toast, readonly, refresh_preset_menu, t],
  );

  /** 重命名后同步默认项引用并刷新列表。 */
  const rename_preset = useCallback(
    async (virtual_id: string, name: string): Promise<boolean> => {
      if (readonly) {
        return false;
      }

      const normalized_name = normalize_preset_name(name);
      if (normalized_name === "") {
        push_toast("warning", t("preset_editor.feedback.name_required"));
        return false;
      }

      try {
        const payload = await api_fetch<{ item?: CustomPromptPresetItem }>(
          "/api/quality/prompts/presets/rename",
          {
            virtual_id,
            new_name: normalized_name,
          },
        );
        const target_preset = preset_items.find((item) => item.virtual_id === virtual_id);
        if (target_preset?.is_default) {
          const settings_payload = await api_fetch<SettingsSnapshotPayload>(
            "/api/settings/update",
            {
              [TRANSLATION_PROMPT.default_preset_setting_key]: String(
                payload.item?.virtual_id ?? "",
              ),
            },
          );
          apply_settings_snapshot(settings_payload);
        }
        await refresh_preset_menu();
        return true;
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.preset_failed")),
        );
        return false;
      }
    },
    [apply_settings_snapshot, preset_items, push_toast, readonly, refresh_preset_menu, t],
  );

  /** 通过设置回包推进默认标记。 */
  const set_default_preset = useCallback(
    async (virtual_id: string): Promise<void> => {
      if (readonly) {
        return;
      }

      try {
        const payload = await api_fetch<SettingsSnapshotPayload>("/api/settings/update", {
          [TRANSLATION_PROMPT.default_preset_setting_key]: virtual_id,
        });
        apply_settings_snapshot(payload);
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.preset_failed")),
        );
      }
    },
    [apply_settings_snapshot, push_toast, readonly, t],
  );

  /** 清除默认引用，由设置快照更新菜单。 */
  const cancel_default_preset = useCallback(async (): Promise<void> => {
    if (readonly) {
      return;
    }

    try {
      const payload = await api_fetch<SettingsSnapshotPayload>("/api/settings/update", {
        [TRANSLATION_PROMPT.default_preset_setting_key]: "",
      });
      apply_settings_snapshot(payload);
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.preset_failed")),
      );
    }
  }, [apply_settings_snapshot, push_toast, readonly, t]);

  /** 释放本轮待确认操作。 */
  const close_confirm_dialog = useCallback((): void => {
    set_confirm_state(CLOSED_CONFIRM_STATE);
  }, []);

  /** 关闭命名流程并清空提交状态。 */
  const close_preset_input_dialog = useCallback((): void => {
    set_preset_input_state(create_empty_preset_input_state());
  }, []);

  /** 保留操作目标，只更新待提交名称。 */
  const update_preset_input_value = useCallback((next_value: string): void => {
    set_preset_input_state((previous_state) => {
      return {
        ...previous_state,
        value: next_value,
      };
    });
  }, []);

  /** 按保存或重命名意图校验重名并推进确认流程。 */
  const submit_preset_input = useCallback(async (): Promise<void> => {
    if (readonly || !preset_input_state.open || preset_input_state.mode === null) {
      return;
    }

    const normalized_name = normalize_preset_name(preset_input_state.value);
    if (normalized_name === "") {
      push_toast("warning", t("preset_editor.feedback.name_required"));
      return;
    }

    const next_virtual_id = build_user_preset_virtual_id(normalized_name, "txt");
    if (
      preset_input_state.mode === "save" &&
      has_casefold_duplicate_preset(preset_items, next_virtual_id, null)
    ) {
      set_confirm_state({
        kind: "overwrite-preset",
        preset_input_value: normalized_name,
        submitting: false,
      });
      return;
    }

    if (
      preset_input_state.mode === "rename" &&
      has_casefold_duplicate_preset(
        preset_items,
        next_virtual_id,
        preset_input_state.target_virtual_id,
      )
    ) {
      push_toast("warning", t("preset_editor.feedback.exists"));
      return;
    }

    set_preset_input_state((previous_state) => {
      return {
        ...previous_state,
        submitting: true,
      };
    });

    const succeeded =
      preset_input_state.mode === "save"
        ? await save_preset(normalized_name)
        : preset_input_state.target_virtual_id === null
          ? false
          : await rename_preset(preset_input_state.target_virtual_id, normalized_name);

    if (succeeded) {
      set_preset_input_state(create_empty_preset_input_state());
    } else {
      set_preset_input_state((previous_state) => {
        return {
          ...previous_state,
          submitting: false,
        };
      });
    }
  }, [preset_input_state, preset_items, push_toast, readonly, rename_preset, save_preset, t]);

  /** 删除预设并清除指向它的默认引用。 */
  const delete_preset = useCallback(
    async (virtual_id: string): Promise<boolean> => {
      try {
        await api_fetch("/api/quality/prompts/presets/delete", {
          virtual_id,
        });
        const target_preset = preset_items.find((item) => item.virtual_id === virtual_id);
        if (target_preset?.is_default) {
          const settings_payload = await api_fetch<SettingsSnapshotPayload>(
            "/api/settings/update",
            { [TRANSLATION_PROMPT.default_preset_setting_key]: "" },
          );
          apply_settings_snapshot(settings_payload);
        }
        await refresh_preset_menu();
        return true;
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.preset_failed")),
        );
        return false;
      }
    },
    [apply_settings_snapshot, preset_items, push_toast, refresh_preset_menu, t],
  );

  /** 执行已确认的操作，失败时恢复确认界面的可操作状态。 */
  const confirm_pending_action = useCallback(async (): Promise<void> => {
    if (readonly || confirm_state.kind === null) {
      return;
    }

    set_confirm_state((previous_state) => {
      if (previous_state.kind === null) {
        return previous_state;
      }
      return {
        ...previous_state,
        submitting: true,
      };
    });

    let succeeded = false;

    switch (confirm_state.kind) {
      case "reset": {
        succeeded = await replace_prompt_text(template.default_text);
        if (succeeded) {
          set_preset_menu_open(false);
        }
        break;
      }
      case "delete-preset": {
        succeeded = await delete_preset(confirm_state.target_virtual_id);
        break;
      }
      case "overwrite-preset": {
        succeeded = await save_preset(confirm_state.preset_input_value);
        if (succeeded) {
          set_preset_input_state(create_empty_preset_input_state());
        }
        break;
      }
    }

    if (succeeded) {
      set_confirm_state(CLOSED_CONFIRM_STATE);
    } else {
      set_confirm_state((previous_state) => {
        if (previous_state.kind === null) {
          return previous_state;
        }
        return {
          ...previous_state,
          submitting: false,
        };
      });
    }
  }, [
    replace_prompt_text,
    confirm_state,
    delete_preset,
    readonly,
    save_preset,
    template.default_text,
  ]);

  return {
    template,
    prompt_text,
    enabled,
    readonly,
    preset_items,
    preset_menu_open,
    confirm_state,
    preset_input_state,
    update_prompt_text,
    update_enabled,
    flush_prompt_change,
    load_status,
    reload_prompt,
    import_prompt_from_picker,
    export_prompt_from_picker,
    open_preset_menu,
    apply_preset,
    request_reset_prompt,
    request_save_preset,
    request_rename_preset,
    request_delete_preset,
    set_default_preset,
    cancel_default_preset,
    confirm_pending_action,
    close_confirm_dialog,
    update_preset_input_value,
    submit_preset_input,
    close_preset_input_dialog,
    set_preset_menu_open,
  };
}
