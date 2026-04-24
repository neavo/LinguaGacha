import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { api_fetch } from "@/app/desktop-api";
import { createProjectStoreReplaceSectionPatch } from "@/app/project/store/project-store";
import { getPromptSlice, replacePromptSlice } from "@/app/project/quality/quality-runtime";
import {
  normalize_project_mutation_ack,
  normalize_settings_snapshot,
  type ProjectMutationAckPayload,
  type SettingsSnapshotPayload,
} from "@/app/runtime/desktop/desktop-runtime-context";
import { useDesktopRuntime } from "@/app/runtime/desktop/use-desktop-runtime";
import { useDesktopToast } from "@/app/runtime/toast/use-desktop-toast";
import { useI18n } from "@/i18n";
import {
  CUSTOM_PROMPT_VARIANT_CONFIG,
  type CustomPromptVariant,
  type CustomPromptVariantConfig,
} from "@/pages/custom-prompt-page/config";
import type {
  CustomPromptConfirmState,
  CustomPromptPresetInputState,
  CustomPromptPresetItem,
  CustomPromptTemplate,
  UseCustomPromptPageStateResult,
} from "@/pages/custom-prompt-page/types";

type PromptSnapshot = {
  revision?: number;
  enabled?: boolean;
  meta?: {
    enabled?: boolean;
  };
  text?: string;
};

type PromptTemplatePayload = {
  template?: Partial<CustomPromptTemplate>;
};

type PromptPresetPayload = {
  builtin_presets?: CustomPromptPresetItem[];
  user_presets?: CustomPromptPresetItem[];
};

type PromptImportPayload = {
  text?: string;
};

function create_empty_prompt_template(): CustomPromptTemplate {
  return {
    default_text: "",
    prefix_text: "",
    suffix_text: "",
  };
}

function create_empty_confirm_state(): CustomPromptConfirmState {
  return {
    open: false,
    kind: null,
    preset_name: "",
    preset_input_value: "",
    submitting: false,
    target_virtual_id: null,
  };
}

function create_empty_preset_input_state(): CustomPromptPresetInputState {
  return {
    open: false,
    mode: null,
    value: "",
    submitting: false,
    target_virtual_id: null,
  };
}

export function normalize_prompt_snapshot(snapshot: PromptSnapshot | undefined): PromptSnapshot {
  return {
    revision: Number(snapshot?.revision ?? 0),
    meta: {
      enabled: Boolean(snapshot?.meta?.enabled ?? snapshot?.enabled),
    },
    text: String(snapshot?.text ?? ""),
  };
}

function normalize_prompt_template(
  template: Partial<CustomPromptTemplate> | undefined,
): CustomPromptTemplate {
  return {
    default_text: String(template?.default_text ?? ""),
    prefix_text: String(template?.prefix_text ?? ""),
    suffix_text: String(template?.suffix_text ?? ""),
  };
}

function normalize_prompt_text(text: string): string {
  return text.trim();
}

function resolve_editor_prompt_text(
  snapshot: PromptSnapshot,
  template: CustomPromptTemplate,
): string {
  const normalized_text = normalize_prompt_text(String(snapshot.text ?? ""));

  if (normalized_text === "") {
    return template.default_text;
  }

  return normalized_text;
}

function build_user_preset_virtual_id(name: string): string {
  return `user:${name}.txt`;
}

function normalize_preset_name(name: string): string {
  return name.trim();
}

function has_casefold_duplicate_preset(
  preset_items: CustomPromptPresetItem[],
  target_virtual_id: string,
  current_virtual_id: string | null,
): boolean {
  const target_key = target_virtual_id.toLocaleLowerCase();

  return preset_items.some((item) => {
    if (item.type !== "user") {
      return false;
    }

    if (current_virtual_id !== null && item.virtual_id === current_virtual_id) {
      return false;
    }

    return item.virtual_id.toLocaleLowerCase() === target_key;
  });
}

function decorate_preset_items(
  builtin_presets: CustomPromptPresetItem[],
  user_presets: CustomPromptPresetItem[],
  default_virtual_id: string,
): CustomPromptPresetItem[] {
  return [...builtin_presets, ...user_presets].map((item) => {
    return {
      ...item,
      is_default: item.virtual_id === default_virtual_id,
    };
  });
}

function build_default_preset_update_payload(
  config: CustomPromptVariantConfig,
  value: string,
): Record<string, string> {
  return {
    [config.default_preset_settings_key]: value,
  };
}

function resolve_error_message(error: unknown, fallback_message: string): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return fallback_message;
}

export function useCustomPromptPageState(
  variant: CustomPromptVariant,
): UseCustomPromptPageStateResult {
  const config = CUSTOM_PROMPT_VARIANT_CONFIG[variant];
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const {
    project_snapshot,
    project_store,
    settings_snapshot,
    set_settings_snapshot,
    commit_local_project_patch,
    refresh_project_runtime,
    align_project_runtime_ack,
  } = useDesktopRuntime();
  const project_store_state = useSyncExternalStore(
    project_store.subscribe,
    project_store.getState,
    project_store.getState,
  );

  const [template, set_template] = useState<CustomPromptTemplate>(() => {
    return create_empty_prompt_template();
  });
  const [prompt_text, set_prompt_text] = useState("");
  const [, set_revision] = useState(0);
  const [enabled, set_enabled] = useState(false);
  const [preset_items, set_preset_items] = useState<CustomPromptPresetItem[]>([]);
  const [preset_menu_open, set_preset_menu_open] = useState(false);
  const [confirm_state, set_confirm_state] = useState<CustomPromptConfirmState>(() => {
    return create_empty_confirm_state();
  });
  const [preset_input_state, set_preset_input_state] = useState<CustomPromptPresetInputState>(
    () => {
      return create_empty_preset_input_state();
    },
  );
  const template_ref = useRef(template);
  const previous_app_language_ref = useRef(settings_snapshot.app_language);

  useEffect(() => {
    template_ref.current = template;
  }, [template]);

  const apply_snapshot = useCallback(
    (snapshot: PromptSnapshot, template_override?: CustomPromptTemplate): void => {
      const resolved_template = template_override ?? template_ref.current;

      set_revision(Number(snapshot.revision ?? 0));
      set_enabled(Boolean(snapshot.meta?.enabled));
      set_prompt_text(resolve_editor_prompt_text(snapshot, resolved_template));
    },
    [],
  );

  const fetch_prompt_template = useCallback(async (): Promise<CustomPromptTemplate> => {
    const payload = await api_fetch<PromptTemplatePayload>("/api/quality/prompts/template", {
      task_type: config.task_type,
    });

    return normalize_prompt_template(payload.template);
  }, [config.task_type]);

  const apply_store_snapshot = useCallback(
    (template_override?: CustomPromptTemplate): void => {
      const prompt_slice = getPromptSlice(project_store_state.prompts, config.task_type);
      apply_snapshot(normalize_prompt_snapshot(prompt_slice), template_override);
    },
    [apply_snapshot, config.task_type, project_store_state.prompts],
  );

  const persist_prompt_change = useCallback(
    async (args: {
      nextText: string;
      nextEnabled: boolean;
      failureMessage: string;
    }): Promise<boolean> => {
      const current_prompt_slice = getPromptSlice(
        project_store.getState().prompts,
        config.task_type,
      );
      const next_prompt_slice = {
        text: normalize_prompt_text(args.nextText),
        enabled: args.nextEnabled,
        revision: current_prompt_slice.revision + 1,
      };
      const next_prompts_state = replacePromptSlice(
        project_store.getState().prompts,
        config.task_type,
        next_prompt_slice,
      );
      const local_commit = commit_local_project_patch({
        source: "quality_prompt_save",
        updatedSections: ["prompts"],
        patch: [createProjectStoreReplaceSectionPatch("prompts", next_prompts_state)],
      });

      try {
        const mutation_ack = normalize_project_mutation_ack(
          await api_fetch<ProjectMutationAckPayload>("/api/quality/prompts/save", {
            task_type: config.task_type,
            expected_revision: current_prompt_slice.revision,
            text: next_prompt_slice.text,
            enabled: next_prompt_slice.enabled,
          }),
        );
        align_project_runtime_ack(mutation_ack);
        return true;
      } catch (error) {
        local_commit.rollback();
        void refresh_project_runtime().catch(() => {});
        push_toast("error", resolve_error_message(error, args.failureMessage));
        return false;
      }
    },
    [
      align_project_runtime_ack,
      commit_local_project_patch,
      config.task_type,
      project_store,
      push_toast,
      refresh_project_runtime,
    ],
  );

  const refresh_template = useCallback(async (): Promise<void> => {
    try {
      const next_template = await fetch_prompt_template();
      set_template(next_template);
    } catch (error) {
      push_toast(
        "error",
        resolve_error_message(error, t("custom_prompt_page.feedback.load_failed")),
      );
    }
  }, [fetch_prompt_template, push_toast, t]);

  useEffect(() => {
    if (!project_snapshot.loaded) {
      set_template(create_empty_prompt_template());
      set_prompt_text("");
      set_revision(0);
      set_enabled(false);
      set_preset_items([]);
      set_preset_menu_open(false);
      set_confirm_state(create_empty_confirm_state());
      set_preset_input_state(create_empty_preset_input_state());
    } else {
      void (async () => {
        try {
          const next_template = await fetch_prompt_template();
          set_template(next_template);
          apply_store_snapshot(next_template);
        } catch (error) {
          push_toast(
            "error",
            resolve_error_message(error, t("custom_prompt_page.feedback.load_failed")),
          );
        }
      })();
    }
  }, [
    apply_store_snapshot,
    fetch_prompt_template,
    project_snapshot.loaded,
    project_snapshot.path,
    push_toast,
    t,
  ]);

  useEffect(() => {
    if (!project_snapshot.loaded) {
      return;
    }

    apply_store_snapshot();
  }, [apply_store_snapshot, project_snapshot.loaded, project_snapshot.path]);

  useEffect(() => {
    if (!project_snapshot.loaded) {
      previous_app_language_ref.current = settings_snapshot.app_language;
      return;
    }

    if (previous_app_language_ref.current === settings_snapshot.app_language) {
      return;
    }

    previous_app_language_ref.current = settings_snapshot.app_language;

    // Why: UI 语言切换只需要刷新模板片段，不能顺手重拉快照覆盖用户尚未保存的正文草稿。
    void refresh_template();
  }, [project_snapshot.loaded, refresh_template, settings_snapshot.app_language]);

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

  const update_prompt_text = useCallback((next_text: string): void => {
    set_prompt_text(next_text);
  }, []);

  const save_prompt_text = useCallback(async (): Promise<void> => {
    const succeeded = await persist_prompt_change({
      nextText: prompt_text,
      nextEnabled: enabled,
      failureMessage: t("custom_prompt_page.feedback.save_failed"),
    });
    if (succeeded) {
      push_toast("success", t("app.feedback.save_success"));
    }
  }, [enabled, persist_prompt_change, prompt_text, push_toast, t]);

  const commit_prompt_text = useCallback(
    async (
      next_text: string,
      success_message_key:
        | "custom_prompt_page.feedback.import_success"
        | "custom_prompt_page.feedback.reset_success",
    ): Promise<boolean> => {
      const succeeded = await persist_prompt_change({
        nextText: next_text,
        nextEnabled: enabled,
        failureMessage: t("custom_prompt_page.feedback.save_failed"),
      });
      if (succeeded) {
        push_toast("success", t(success_message_key));
        return true;
      }
      return false;
    },
    [enabled, persist_prompt_change, push_toast, t],
  );

  const update_enabled = useCallback(
    async (next_enabled: boolean): Promise<void> => {
      await persist_prompt_change({
        nextText: prompt_text,
        nextEnabled: next_enabled,
        failureMessage: t("custom_prompt_page.feedback.save_failed"),
      });
    },
    [persist_prompt_change, prompt_text, t],
  );

  const import_prompt_from_picker = useCallback(async (): Promise<void> => {
    try {
      const pick_result = await window.desktopApp.pickPromptImportFilePath();
      if (pick_result.canceled || pick_result.path === null) {
        return;
      }

      const payload = await api_fetch<PromptImportPayload>("/api/quality/prompts/import", {
        task_type: config.task_type,
        path: pick_result.path,
      });
      const succeeded = await commit_prompt_text(
        String(payload.text ?? ""),
        "custom_prompt_page.feedback.import_success",
      );
      if (!succeeded) {
        return;
      }
    } catch (error) {
      push_toast(
        "error",
        resolve_error_message(error, t("custom_prompt_page.feedback.import_failed")),
      );
    }
  }, [commit_prompt_text, config.task_type, push_toast, t]);

  const export_prompt_from_picker = useCallback(async (): Promise<void> => {
    try {
      const pick_result = await window.desktopApp.pickPromptExportFilePath();
      if (pick_result.canceled || pick_result.path === null) {
        return;
      }

      await api_fetch("/api/quality/prompts/export", {
        task_type: config.task_type,
        path: pick_result.path,
      });
      push_toast("success", t("custom_prompt_page.feedback.export_success"));
    } catch (error) {
      push_toast(
        "error",
        resolve_error_message(error, t("custom_prompt_page.feedback.export_failed")),
      );
    }
  }, [config.task_type, push_toast, t]);

  const open_preset_menu = useCallback(async (): Promise<void> => {
    try {
      await refresh_preset_menu();
    } catch (error) {
      push_toast(
        "error",
        resolve_error_message(error, t("custom_prompt_page.feedback.preset_failed")),
      );
    }
  }, [push_toast, refresh_preset_menu, t]);

  const apply_preset = useCallback(
    async (virtual_id: string): Promise<void> => {
      try {
        const payload = await api_fetch<{ text?: string }>("/api/quality/prompts/presets/read", {
          task_type: config.task_type,
          virtual_id,
        });
        const succeeded = await commit_prompt_text(
          String(payload.text ?? ""),
          "custom_prompt_page.feedback.import_success",
        );
        if (succeeded) {
          set_preset_menu_open(false);
        }
      } catch (error) {
        push_toast(
          "error",
          resolve_error_message(error, t("custom_prompt_page.feedback.preset_failed")),
        );
      }
    },
    [commit_prompt_text, config.task_type, push_toast, t],
  );

  const request_reset_prompt = useCallback((): void => {
    set_confirm_state({
      open: true,
      kind: "reset",
      preset_name: "",
      preset_input_value: "",
      submitting: false,
      target_virtual_id: null,
    });
  }, []);

  const request_save_preset = useCallback((): void => {
    set_preset_input_state({
      open: true,
      mode: "save",
      value: "",
      submitting: false,
      target_virtual_id: null,
    });
  }, []);

  const request_rename_preset = useCallback((preset_item: CustomPromptPresetItem): void => {
    set_preset_input_state({
      open: true,
      mode: "rename",
      value: preset_item.name,
      submitting: false,
      target_virtual_id: preset_item.virtual_id,
    });
  }, []);

  const request_delete_preset = useCallback((preset_item: CustomPromptPresetItem): void => {
    set_confirm_state({
      open: true,
      kind: "delete-preset",
      preset_name: preset_item.name,
      preset_input_value: "",
      submitting: false,
      target_virtual_id: preset_item.virtual_id,
    });
  }, []);

  const save_preset = useCallback(
    async (name: string): Promise<boolean> => {
      const normalized_name = normalize_preset_name(name);
      if (normalized_name === "") {
        push_toast("warning", t("custom_prompt_page.feedback.preset_name_required"));
        return false;
      }

      try {
        await api_fetch("/api/quality/prompts/presets/save", {
          task_type: config.task_type,
          name: normalized_name,
          text: normalize_prompt_text(prompt_text),
        });
        await refresh_preset_menu();
        push_toast("success", t("custom_prompt_page.feedback.preset_saved"));
        return true;
      } catch (error) {
        push_toast(
          "error",
          resolve_error_message(error, t("custom_prompt_page.feedback.preset_failed")),
        );
        return false;
      }
    },
    [config.task_type, prompt_text, push_toast, refresh_preset_menu, t],
  );

  const rename_preset = useCallback(
    async (virtual_id: string, name: string): Promise<boolean> => {
      const normalized_name = normalize_preset_name(name);
      if (normalized_name === "") {
        push_toast("warning", t("custom_prompt_page.feedback.preset_name_required"));
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
          set_settings_snapshot(normalize_settings_snapshot(settings_payload));
        }
        await refresh_preset_menu();
        push_toast("success", t("custom_prompt_page.feedback.preset_renamed"));
        return true;
      } catch (error) {
        push_toast(
          "error",
          resolve_error_message(error, t("custom_prompt_page.feedback.preset_failed")),
        );
        return false;
      }
    },
    [config, preset_items, push_toast, refresh_preset_menu, set_settings_snapshot, t],
  );

  const set_default_preset = useCallback(
    async (virtual_id: string): Promise<void> => {
      try {
        const payload = await api_fetch<SettingsSnapshotPayload>(
          "/api/settings/update",
          build_default_preset_update_payload(config, virtual_id),
        );
        set_settings_snapshot(normalize_settings_snapshot(payload));
        await refresh_preset_menu();
        push_toast("success", t("custom_prompt_page.feedback.default_preset_set"));
      } catch (error) {
        push_toast(
          "error",
          resolve_error_message(error, t("custom_prompt_page.feedback.preset_failed")),
        );
      }
    },
    [config, push_toast, refresh_preset_menu, set_settings_snapshot, t],
  );

  const cancel_default_preset = useCallback(async (): Promise<void> => {
    try {
      const payload = await api_fetch<SettingsSnapshotPayload>(
        "/api/settings/update",
        build_default_preset_update_payload(config, ""),
      );
      set_settings_snapshot(normalize_settings_snapshot(payload));
      await refresh_preset_menu();
      push_toast("success", t("custom_prompt_page.feedback.default_preset_cleared"));
    } catch (error) {
      push_toast(
        "error",
        resolve_error_message(error, t("custom_prompt_page.feedback.preset_failed")),
      );
    }
  }, [config, push_toast, refresh_preset_menu, set_settings_snapshot, t]);

  const close_confirm_dialog = useCallback((): void => {
    set_confirm_state(create_empty_confirm_state());
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
    if (!preset_input_state.open || preset_input_state.mode === null) {
      return;
    }

    const normalized_name = normalize_preset_name(preset_input_state.value);
    if (normalized_name === "") {
      push_toast("warning", t("custom_prompt_page.feedback.preset_name_required"));
      return;
    }

    const next_virtual_id = build_user_preset_virtual_id(normalized_name);
    if (
      preset_input_state.mode === "save" &&
      has_casefold_duplicate_preset(preset_items, next_virtual_id, null)
    ) {
      set_confirm_state({
        open: true,
        kind: "overwrite-preset",
        preset_name: normalized_name,
        preset_input_value: normalized_name,
        submitting: false,
        target_virtual_id: null,
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
      push_toast("warning", t("custom_prompt_page.feedback.preset_exists"));
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
  }, [preset_input_state, preset_items, push_toast, rename_preset, save_preset, t]);

  const confirm_pending_action = useCallback(async (): Promise<void> => {
    if (!confirm_state.open || confirm_state.kind === null) {
      return;
    }

    set_confirm_state((previous_state) => {
      return {
        ...previous_state,
        submitting: true,
      };
    });

    let succeeded = false;

    if (confirm_state.kind === "reset") {
      succeeded = await commit_prompt_text(
        template.default_text,
        "custom_prompt_page.feedback.reset_success",
      );
      if (succeeded) {
        set_preset_menu_open(false);
      }
    } else if (confirm_state.kind === "delete-preset") {
      try {
        if (confirm_state.target_virtual_id !== null) {
          await api_fetch("/api/quality/prompts/presets/delete", {
            task_type: config.task_type,
            virtual_id: confirm_state.target_virtual_id,
          });
          const target_preset = preset_items.find((item) => {
            return item.virtual_id === confirm_state.target_virtual_id;
          });
          if (target_preset?.is_default) {
            const settings_payload = await api_fetch<SettingsSnapshotPayload>(
              "/api/settings/update",
              build_default_preset_update_payload(config, ""),
            );
            set_settings_snapshot(normalize_settings_snapshot(settings_payload));
          }
          await refresh_preset_menu();
          push_toast("success", t("custom_prompt_page.feedback.preset_deleted"));
          succeeded = true;
        }
      } catch (error) {
        push_toast(
          "error",
          resolve_error_message(error, t("custom_prompt_page.feedback.preset_failed")),
        );
      }
    } else {
      succeeded = await save_preset(confirm_state.preset_input_value);
      if (succeeded) {
        set_preset_input_state(create_empty_preset_input_state());
      }
    }

    if (succeeded) {
      set_confirm_state(create_empty_confirm_state());
    } else {
      set_confirm_state((previous_state) => {
        return {
          ...previous_state,
          submitting: false,
        };
      });
    }
  }, [
    commit_prompt_text,
    config,
    confirm_state,
    preset_items,
    push_toast,
    refresh_preset_menu,
    save_preset,
    set_settings_snapshot,
    t,
    template.default_text,
  ]);

  return useMemo<UseCustomPromptPageStateResult>(() => {
    return {
      title_key: config.title_key,
      header_title_key: config.header_title_key,
      header_description_key: config.header_description_key,
      template,
      prompt_text,
      enabled,
      preset_items,
      preset_menu_open,
      confirm_state,
      preset_input_state,
      update_prompt_text,
      update_enabled,
      save_prompt_text,
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
  }, [
    apply_preset,
    cancel_default_preset,
    close_confirm_dialog,
    close_preset_input_dialog,
    config.header_description_key,
    config.header_title_key,
    config.title_key,
    confirm_pending_action,
    confirm_state,
    enabled,
    export_prompt_from_picker,
    import_prompt_from_picker,
    open_preset_menu,
    preset_input_state,
    preset_items,
    preset_menu_open,
    prompt_text,
    request_delete_preset,
    request_rename_preset,
    request_reset_prompt,
    request_save_preset,
    save_prompt_text,
    set_default_preset,
    submit_preset_input,
    template,
    update_enabled,
    update_preset_input_value,
    update_prompt_text,
  ]);
}
