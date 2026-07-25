import { useCallback, useEffect, useRef, useState } from "react";

import { api_fetch, DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  type ProjectWriteOperation,
  type ProjectWriteResult,
  type ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";
import { is_project_write_locked } from "@frontend/app/state/task-snapshot-store";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import {
  CUSTOM_PROMPT_VARIANT_CONFIG,
  type CustomPromptVariant,
} from "@frontend/pages/custom-prompt-page/config";
import type { CustomPromptTemplate } from "@frontend/pages/custom-prompt-page/types";
import { useDebouncedCallback } from "@frontend/widgets/interactions/use-debounce";
import { InternalInvariantError } from "@shared/error";

type PromptSlice = {
  text: string;
  enabled: boolean;
};

type PromptTemplatePayload = {
  template?: Partial<CustomPromptTemplate>;
};

type PromptQueryPayload = {
  sectionRevisions?: {
    prompts?: unknown;
  };
  prompt?: Partial<PromptSlice>;
};

type UseCustomPromptEditorStateResult = {
  template: CustomPromptTemplate;
  prompt_text: string;
  enabled: boolean;
  readonly: boolean;
  update_prompt_text: (next_text: string) => void;
  update_enabled: (next_enabled: boolean) => Promise<boolean>;
  replace_prompt_text: (next_text: string) => Promise<boolean>;
  flush_prompt_change: () => Promise<boolean>;
};

const CUSTOM_PROMPT_SAVE_WRITE: ProjectWriteOperation = "custom-prompt.prompt_save";
export const CUSTOM_PROMPT_AUTOSAVE_DELAY_MS = 1000;

function create_empty_prompt_template(): CustomPromptTemplate {
  return {
    default_text: "",
    prefix_text: "",
    suffix_text: "",
  };
}

function create_empty_prompt_slice(): PromptSlice {
  return {
    text: "",
    enabled: false,
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

function normalize_prompt_slice(slice: PromptSlice): PromptSlice {
  return {
    text: normalize_prompt_text(slice.text),
    enabled: slice.enabled,
  };
}

function resolve_editor_prompt_text(snapshot: PromptSlice, template: CustomPromptTemplate): string {
  const normalized_text = normalize_prompt_text(String(snapshot.text ?? ""));
  return normalized_text === "" ? template.default_text : normalized_text;
}

function are_prompt_slices_equal(left: PromptSlice, right: PromptSlice): boolean {
  return left.text === right.text && left.enabled === right.enabled;
}

function read_prompts_revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new InternalInvariantError({
      diagnostic_context: {
        reason: "invalid_custom_prompt_revision",
      },
    });
  }
  return value;
}

function read_write_prompts_revision(write_result: ProjectWriteResult): number {
  const revision = write_result.changes.at(-1)?.sectionRevisions?.prompts;
  return read_prompts_revision(revision);
}

export function useCustomPromptEditorState(
  variant: CustomPromptVariant,
): UseCustomPromptEditorStateResult {
  const config = CUSTOM_PROMPT_VARIANT_CONFIG[variant];
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const { project_snapshot, settings_snapshot, commit_project_write, task_snapshot } =
    useDesktopState();
  const readonly = is_project_write_locked(task_snapshot);

  const [template, set_template] = useState<CustomPromptTemplate>(() => {
    return create_empty_prompt_template();
  });
  const [prompt_text, set_prompt_text] = useState("");
  const [enabled, set_enabled] = useState(false);
  const desired_ref = useRef<PromptSlice>(create_empty_prompt_slice());
  const persisted_ref = useRef<PromptSlice>(create_empty_prompt_slice());
  const prompts_revision_ref = useRef(0);
  const write_promise_ref = useRef<{
    generation: number;
    promise: Promise<boolean>;
  } | null>(null);
  const identity_generation_ref = useRef(0);
  const previous_readonly_ref = useRef(readonly);
  const previous_app_language_ref = useRef(settings_snapshot.app_language);
  const readonly_ref = useRef(readonly);

  const fetch_prompt_template = useCallback(async (): Promise<CustomPromptTemplate> => {
    const payload = await api_fetch<PromptTemplatePayload>("/api/quality/prompts/template", {
      task_type: config.task_type,
    });
    return normalize_prompt_template(payload.template);
  }, [config.task_type]);

  const fetch_prompt_snapshot = useCallback(async (): Promise<{
    slice: PromptSlice;
    prompts_revision: number;
  }> => {
    const payload = await api_fetch<PromptQueryPayload>("/api/quality/prompts/view", {
      task_type: config.task_type,
    });
    return {
      slice: {
        text: String(payload.prompt?.text ?? ""),
        enabled: Boolean(payload.prompt?.enabled),
      },
      prompts_revision: read_prompts_revision(payload.sectionRevisions?.prompts),
    };
  }, [config.task_type]);

  const commit_captured_slice = useCallback(
    async (
      captured_slice: PromptSlice,
      generation: number,
      allow_revision_retry: boolean,
    ): Promise<boolean> => {
      try {
        const result = await commit_project_write({
          operation: CUSTOM_PROMPT_SAVE_WRITE,
          task_type: config.task_type,
          run: async () => {
            return await api_fetch<ProjectWriteResultPayload>("/api/quality/prompts/save", {
              task_type: config.task_type,
              expected_section_revisions: {
                prompts: prompts_revision_ref.current,
              },
              text: captured_slice.text,
              enabled: captured_slice.enabled,
            });
          },
        });
        if (identity_generation_ref.current === generation) {
          persisted_ref.current = captured_slice;
          prompts_revision_ref.current = read_write_prompts_revision(result.write_result);
        }
        return true;
      } catch (error) {
        if (
          allow_revision_retry &&
          error instanceof DesktopApiError &&
          error.code === "data.revision_conflict" &&
          identity_generation_ref.current === generation
        ) {
          try {
            const refreshed_snapshot = await fetch_prompt_snapshot();
            if (identity_generation_ref.current !== generation) {
              return false;
            }
            prompts_revision_ref.current = refreshed_snapshot.prompts_revision;
            return await commit_captured_slice(captured_slice, generation, false);
          } catch (refresh_error) {
            if (identity_generation_ref.current === generation) {
              push_toast(
                "error",
                resolve_visible_error_message(
                  refresh_error,
                  t,
                  t("custom_prompt_page.feedback.save_failed"),
                ),
              );
            }
            return false;
          }
        }
        if (identity_generation_ref.current === generation) {
          push_toast(
            "error",
            resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.save_failed")),
          );
        }
        return false;
      }
    },
    [commit_project_write, config.task_type, fetch_prompt_snapshot, push_toast, t],
  );

  const drain_prompt_change = useCallback(async (): Promise<boolean> => {
    const active_write = write_promise_ref.current;
    if (active_write !== null) {
      const current_generation = identity_generation_ref.current;
      const succeeded = await active_write.promise;
      if (active_write.generation === current_generation) {
        return succeeded;
      }
      return await drain_prompt_change();
    }
    if (are_prompt_slices_equal(desired_ref.current, persisted_ref.current)) {
      return true;
    }
    if (readonly) {
      return false;
    }

    const generation = identity_generation_ref.current;
    const write_promise = (async (): Promise<boolean> => {
      while (
        identity_generation_ref.current === generation &&
        !readonly_ref.current &&
        !are_prompt_slices_equal(desired_ref.current, persisted_ref.current)
      ) {
        const captured_slice = { ...desired_ref.current };
        if (!(await commit_captured_slice(captured_slice, generation, true))) {
          return false;
        }
      }
      return (
        identity_generation_ref.current === generation &&
        are_prompt_slices_equal(desired_ref.current, persisted_ref.current)
      );
    })();
    write_promise_ref.current = {
      generation,
      promise: write_promise,
    };
    try {
      return await write_promise;
    } finally {
      if (write_promise_ref.current?.promise === write_promise) {
        write_promise_ref.current = null;
      }
    }
  }, [commit_captured_slice, readonly]);

  const debounced_prompt_save = useDebouncedCallback(() => {
    void drain_prompt_change();
  }, CUSTOM_PROMPT_AUTOSAVE_DELAY_MS);

  const flush_prompt_change = useCallback(async (): Promise<boolean> => {
    debounced_prompt_save.cancel();
    return await drain_prompt_change();
  }, [debounced_prompt_save, drain_prompt_change]);

  const refresh_template = useCallback(async (): Promise<void> => {
    const generation = identity_generation_ref.current;
    try {
      const next_template = await fetch_prompt_template();
      if (identity_generation_ref.current === generation) {
        set_template(next_template);
      }
    } catch (error) {
      if (identity_generation_ref.current === generation) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.load_failed")),
        );
      }
    }
  }, [fetch_prompt_template, push_toast, t]);

  useEffect(() => {
    const generation = identity_generation_ref.current + 1;
    identity_generation_ref.current = generation;
    debounced_prompt_save.cancel();

    if (!project_snapshot.loaded) {
      const empty_slice = create_empty_prompt_slice();
      set_template(create_empty_prompt_template());
      set_prompt_text("");
      set_enabled(false);
      desired_ref.current = empty_slice;
      persisted_ref.current = empty_slice;
      prompts_revision_ref.current = 0;
      return;
    }

    void (async () => {
      try {
        const next_template = await fetch_prompt_template();
        const prompt_snapshot = await fetch_prompt_snapshot();
        if (identity_generation_ref.current !== generation) {
          return;
        }
        const editor_text = resolve_editor_prompt_text(prompt_snapshot.slice, next_template);
        const resolved_slice = normalize_prompt_slice({
          text: editor_text,
          enabled: prompt_snapshot.slice.enabled,
        });
        set_template(next_template);
        set_prompt_text(editor_text);
        set_enabled(prompt_snapshot.slice.enabled);
        desired_ref.current = resolved_slice;
        persisted_ref.current = resolved_slice;
        prompts_revision_ref.current = prompt_snapshot.prompts_revision;
      } catch (error) {
        if (identity_generation_ref.current === generation) {
          push_toast(
            "error",
            resolve_visible_error_message(error, t, t("custom_prompt_page.feedback.load_failed")),
          );
        }
      }
    })();
  }, [
    config.task_type,
    debounced_prompt_save,
    fetch_prompt_snapshot,
    fetch_prompt_template,
    project_snapshot.loaded,
    project_snapshot.path,
    push_toast,
    t,
  ]);

  useEffect(() => {
    if (!project_snapshot.loaded) {
      previous_app_language_ref.current = settings_snapshot.app_language;
      return;
    }
    if (previous_app_language_ref.current === settings_snapshot.app_language) {
      return;
    }
    previous_app_language_ref.current = settings_snapshot.app_language;
    void refresh_template();
  }, [project_snapshot.loaded, refresh_template, settings_snapshot.app_language]);

  useEffect(() => {
    const was_readonly = previous_readonly_ref.current;
    previous_readonly_ref.current = readonly;
    readonly_ref.current = readonly;
    if (readonly) {
      debounced_prompt_save.cancel();
      return;
    }
    if (was_readonly && !are_prompt_slices_equal(desired_ref.current, persisted_ref.current)) {
      debounced_prompt_save.schedule();
    }
  }, [debounced_prompt_save, readonly]);

  const drain_prompt_change_ref = useRef(drain_prompt_change);
  useEffect(() => {
    drain_prompt_change_ref.current = drain_prompt_change;
  }, [drain_prompt_change]);

  useEffect(() => {
    return () => {
      debounced_prompt_save.cancel();
      if (!readonly_ref.current) {
        void drain_prompt_change_ref.current();
      }
    };
  }, [debounced_prompt_save]);

  const update_prompt_text = useCallback(
    (next_text: string): void => {
      if (readonly) {
        return;
      }
      set_prompt_text(next_text);
      desired_ref.current = {
        ...desired_ref.current,
        text: normalize_prompt_text(next_text),
      };
      debounced_prompt_save.schedule();
    },
    [debounced_prompt_save, readonly],
  );

  const replace_prompt_text = useCallback(
    async (next_text: string): Promise<boolean> => {
      if (readonly) {
        return false;
      }
      debounced_prompt_save.cancel();
      const previous_slice = desired_ref.current;
      const previous_prompt_text = prompt_text;
      const next_slice = {
        ...previous_slice,
        text: normalize_prompt_text(next_text),
      };
      set_prompt_text(next_slice.text);
      desired_ref.current = next_slice;
      const succeeded = await drain_prompt_change();
      if (!succeeded && are_prompt_slices_equal(desired_ref.current, next_slice)) {
        desired_ref.current = previous_slice;
        set_prompt_text(previous_prompt_text);
        if (!are_prompt_slices_equal(previous_slice, persisted_ref.current)) {
          debounced_prompt_save.schedule();
        }
      }
      return succeeded;
    },
    [debounced_prompt_save, drain_prompt_change, prompt_text, readonly],
  );

  const update_enabled = useCallback(
    async (next_enabled: boolean): Promise<boolean> => {
      if (readonly) {
        return false;
      }
      debounced_prompt_save.cancel();
      const previous_slice = desired_ref.current;
      const next_slice = {
        ...previous_slice,
        enabled: next_enabled,
      };
      desired_ref.current = next_slice;
      const succeeded = await drain_prompt_change();
      if (succeeded) {
        set_enabled(next_enabled);
        push_toast(
          "success",
          t(next_enabled ? "app.feedback.feature_enabled" : "app.feedback.feature_disabled", {
            TITLE: t(config.header_title_key),
          }),
        );
      } else if (are_prompt_slices_equal(desired_ref.current, next_slice)) {
        desired_ref.current = previous_slice;
        if (!are_prompt_slices_equal(previous_slice, persisted_ref.current)) {
          debounced_prompt_save.schedule();
        }
      }
      return succeeded;
    },
    [config.header_title_key, debounced_prompt_save, drain_prompt_change, push_toast, readonly, t],
  );

  return {
    template,
    prompt_text,
    enabled,
    readonly,
    update_prompt_text,
    update_enabled,
    replace_prompt_text,
    flush_prompt_change,
  };
}
