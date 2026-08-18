import { useCallback, useEffect, useState } from "react";

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
import {
  CUSTOM_PROMPT_VARIANT_CONFIG,
  type CustomPromptVariant,
  type CustomPromptVariantConfig,
} from "@frontend/pages/custom-prompt-page/config";
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
 * 导入、预设和编辑器保存共用首尾空白归一化规则。
 */
function normalize_prompt_text(text: string): string {
  return text.trim();
}

/**
 * 默认预设键由提示词变体配置拥有，调用点只提交值。
 */
function build_default_preset_update_payload(
  config: CustomPromptVariantConfig,
  value: string,
): Record<string, string> {
  return {
    [config.default_preset_settings_key]: value,
  };
}

/**
 * 拥有单个提示词变体的预设菜单、确认流程与导入导出状态。
 */
export function useCustomPromptPageState(
  variant: CustomPromptVariant,
): UseCustomPromptPageStateResult {
  const config = CUSTOM_PROMPT_VARIANT_CONFIG[variant];
  const {
    template,
    prompt_text,
    enabled,
    readonly,
    update_prompt_text,
    update_enabled,
    replace_prompt_text,
    flush_prompt_change,
  } = useCustomPromptEditorState(variant);
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const { project_snapshot, settings_snapshot, apply_settings_snapshot } = useDesktopState();
  const [preset_items, set_preset_items] = useState<CustomPromptPresetItem[]>([]);
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
      set_preset_items([]);
      set_preset_menu_open(false);
      set_confirm_state(CLOSED_CONFIRM_STATE);
      set_preset_input_state(create_empty_preset_input_state());
    }
  }, [project_snapshot.loaded, project_snapshot.path]);

  const refresh_preset_menu = useCallback(async (): Promise<void> => {
    const preset_payload = await api_fetch<PromptPresetPayload>("/api/quality/prompts/presets", {
      task_type: config.task_type,
    });
    const default_virtual_id = String(settings_snapshot[config.default_preset_settings_key] ?? "");

    set_preset_items(
      decorate_preset_items(
        preset_payload.builtin_presets ?? [],
        preset_payload.user_presets ?? [],
        default_virtual_id,
      ),
    );
  }, [config.default_preset_settings_key, config.task_type, settings_snapshot]);

  const commit_prompt_text = useCallback(
    async (
      next_text: string,
      success_message_key: "app.feedback.import_success" | "app.feedback.reset_success",
    ): Promise<boolean> => {
      if (readonly) {
        return false;
      }

      const succeeded = await replace_prompt_text(next_text);
      if (succeeded) {
        push_toast("success", t(success_message_key));
        return true;
      }
      return false;
    },
    [push_toast, readonly, replace_prompt_text, t],
  );

  const import_prompt_text = useCallback(
    async (next_text: string): Promise<boolean> => {
      return await commit_prompt_text(next_text, "app.feedback.import_success");
    },
    [commit_prompt_text],
  );

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
        task_type: config.task_type,
        path: selected_path,
      });
      await import_prompt_text(String(payload.text ?? ""));
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.import_failed")),
      );
    }
  }, [config.task_type, import_prompt_text, push_toast, readonly, t]);

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
        task_type: config.task_type,
        path: selected_path,
      });
      push_toast("success", t("app.feedback.export_success"));
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.export_failed")),
      );
    }
  }, [config.task_type, flush_prompt_change, push_toast, t]);

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

  const apply_preset = useCallback(
    async (virtual_id: string): Promise<void> => {
      if (readonly) {
        return;
      }

      try {
        const payload = await api_fetch<{ text?: string }>("/api/quality/prompts/presets/read", {
          task_type: config.task_type,
          virtual_id,
        });
        const succeeded = await import_prompt_text(String(payload.text ?? ""));
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
    [config.task_type, import_prompt_text, push_toast, readonly, t],
  );

  const request_reset_prompt = useCallback((): void => {
    if (readonly) {
      return;
    }

    set_confirm_state({
      kind: "reset",
      submitting: false,
    });
  }, [readonly]);

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
          task_type: config.task_type,
          name: normalized_name,
          text: normalize_prompt_text(prompt_text),
        });
        await refresh_preset_menu();
        push_toast("success", t("preset_editor.feedback.saved"));
        return true;
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.preset_failed")),
        );
        return false;
      }
    },
    [config.task_type, prompt_text, push_toast, readonly, refresh_preset_menu, t],
  );

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
            task_type: config.task_type,
            virtual_id,
            new_name: normalized_name,
          },
        );
        const target_preset = preset_items.find((item) => item.virtual_id === virtual_id);
        if (target_preset?.is_default) {
          const settings_payload = await api_fetch<SettingsSnapshotPayload>(
            "/api/settings/update",
            build_default_preset_update_payload(config, String(payload.item?.virtual_id ?? "")),
          );
          apply_settings_snapshot(settings_payload);
        }
        await refresh_preset_menu();
        push_toast("success", t("custom_prompt_page.feedback.preset_succeeded"));
        return true;
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.preset_failed")),
        );
        return false;
      }
    },
    [apply_settings_snapshot, config, preset_items, push_toast, readonly, refresh_preset_menu, t],
  );

  const set_default_preset = useCallback(
    async (virtual_id: string): Promise<void> => {
      if (readonly) {
        return;
      }

      try {
        const payload = await api_fetch<SettingsSnapshotPayload>(
          "/api/settings/update",
          build_default_preset_update_payload(config, virtual_id),
        );
        apply_settings_snapshot(payload);
        await refresh_preset_menu();
        push_toast("success", t("preset_editor.feedback.default_set"));
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.preset_failed")),
        );
      }
    },
    [apply_settings_snapshot, config, push_toast, readonly, refresh_preset_menu, t],
  );

  const cancel_default_preset = useCallback(async (): Promise<void> => {
    if (readonly) {
      return;
    }

    try {
      const payload = await api_fetch<SettingsSnapshotPayload>(
        "/api/settings/update",
        build_default_preset_update_payload(config, ""),
      );
      apply_settings_snapshot(payload);
      await refresh_preset_menu();
      push_toast("success", t("preset_editor.feedback.default_cleared"));
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.preset_failed")),
      );
    }
  }, [apply_settings_snapshot, config, push_toast, readonly, refresh_preset_menu, t]);

  const close_confirm_dialog = useCallback((): void => {
    set_confirm_state(CLOSED_CONFIRM_STATE);
  }, []);

  const close_preset_input_dialog = useCallback((): void => {
    set_preset_input_state(create_empty_preset_input_state());
  }, []);

  const update_preset_input_value = useCallback((next_value: string): void => {
    set_preset_input_state((previous_state) => {
      return {
        ...previous_state,
        value: next_value,
      };
    });
  }, []);

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

  const delete_preset = useCallback(
    async (virtual_id: string): Promise<boolean> => {
      try {
        await api_fetch("/api/quality/prompts/presets/delete", {
          task_type: config.task_type,
          virtual_id,
        });
        const target_preset = preset_items.find((item) => item.virtual_id === virtual_id);
        if (target_preset?.is_default) {
          const settings_payload = await api_fetch<SettingsSnapshotPayload>(
            "/api/settings/update",
            build_default_preset_update_payload(config, ""),
          );
          apply_settings_snapshot(settings_payload);
        }
        await refresh_preset_menu();
        push_toast("success", t("custom_prompt_page.feedback.preset_succeeded"));
        return true;
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.preset_failed")),
        );
        return false;
      }
    },
    [apply_settings_snapshot, config, preset_items, push_toast, refresh_preset_menu, t],
  );

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
        succeeded = await commit_prompt_text(template.default_text, "app.feedback.reset_success");
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
    commit_prompt_text,
    confirm_state,
    delete_preset,
    readonly,
    save_preset,
    template.default_text,
  ]);

  return {
    title_key: config.title_key,
    header_title_key: config.header_title_key,
    header_description_key: config.header_description_key,
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
