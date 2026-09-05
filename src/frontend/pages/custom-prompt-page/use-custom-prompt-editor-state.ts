import { useCallback, useEffect, useRef, useState } from "react";

import { api_fetch, DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  type ProjectWriteOperation,
  type ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import {
  CUSTOM_PROMPT_VARIANT_CONFIG,
  type CustomPromptVariant,
} from "@frontend/pages/custom-prompt-page/config";
import type {
  CustomPromptTemplate,
  PromptSaveStatus,
} from "@frontend/pages/custom-prompt-page/types";
import { useDebouncedCallback } from "@frontend/widgets/interactions/use-debounce";
import { AppError } from "@shared/error";

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
  load_status: "loading" | "ready" | "error";
  reload_prompt: () => Promise<void>;
  save_status: PromptSaveStatus;
  discard_prompt_change: () => void;

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

const EMPTY_PROMPT_TEMPLATE: CustomPromptTemplate = {
  default_text: "",
  prefix_text: "",
  suffix_text: "",
};
const EMPTY_PROMPT_SLICE: PromptSlice = { text: "", enabled: false };

/** 收窄模板回包中的可选文本字段。 */
function normalize_prompt_template(
  template: Partial<CustomPromptTemplate> | undefined,
): CustomPromptTemplate {
  return {
    default_text: String(template?.default_text ?? ""),
    prefix_text: String(template?.prefix_text ?? ""),
    suffix_text: String(template?.suffix_text ?? ""),
  };
}

/** 正文和启用状态共同决定草稿是否已保存。 */
function are_prompt_slices_equal(left: PromptSlice, right: PromptSlice): boolean {
  return left.text === right.text && left.enabled === right.enabled;
}

/** 查询与写入回包必须提供可用于下一次提交的 revision。 */
function read_prompts_revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AppError("runtime.internal_invariant", {
      diagnostic_context: {
        reason: "invalid_custom_prompt_revision",
      },
    });
  }
  return value;
}

/** 管理当前项目的提示词草稿、串行保存与恢复状态。 */
export function useCustomPromptEditorState(
  variant: CustomPromptVariant,
): UseCustomPromptEditorStateResult {
  const config = CUSTOM_PROMPT_VARIANT_CONFIG[variant];
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const { project_snapshot, settings_snapshot, commit_project_write } = useDesktopState();
  const runtime_snapshot = useRuntimeSnapshot();
  const [load_status, set_load_status] = useState<"loading" | "ready" | "error">("loading");
  const [save_status, set_save_status] = useState<PromptSaveStatus>("saved");
  const readonly = is_runtime_busy(runtime_snapshot) || load_status !== "ready";

  const [template, set_template] = useState<CustomPromptTemplate>(EMPTY_PROMPT_TEMPLATE);
  const [prompt_text, set_prompt_text] = useState("");
  const [enabled, set_enabled] = useState(false);
  const desired_ref = useRef<PromptSlice>(EMPTY_PROMPT_SLICE); // 当前编辑意图，每次编辑替换整个值。
  const persisted_ref = useRef<PromptSlice>(EMPTY_PROMPT_SLICE); // 仅成功查询或写入推进保存基线。
  const prompts_revision_ref = useRef(0); // 下一次写入使用后端确认的乐观锁 revision。
  const write_promise_ref = useRef<{
    generation: number;
    promise: Promise<boolean>;
  } | null>(null);
  const identity_generation_ref = useRef(0); // 项目切换与卸载隔离旧查询和在途写入回包。
  const previous_readonly_ref = useRef(readonly);
  const previous_app_language_ref = useRef(settings_snapshot.app_language);
  const readonly_ref = useRef(readonly);

  /** 读取固定模板及默认正文。 */
  const fetch_prompt_template = useCallback(async (): Promise<CustomPromptTemplate> => {
    const payload = await api_fetch<PromptTemplatePayload>("/api/quality/prompts/template", {});
    return normalize_prompt_template(payload.template);
  }, []);

  /** 正文与 revision 来自同一次权威查询。 */
  const fetch_prompt_snapshot = useCallback(async (): Promise<{
    slice: PromptSlice;
    prompts_revision: number;
  }> => {
    const payload = await api_fetch<PromptQueryPayload>("/api/quality/prompts/view", {});
    return {
      slice: {
        text: String(payload.prompt?.text ?? ""),
        enabled: Boolean(payload.prompt?.enabled),
      },
      prompts_revision: read_prompts_revision(payload.sectionRevisions?.prompts),
    };
  }, []);

  /** 保存捕获的草稿；revision 冲突刷新后只重试一次。 */
  const commit_captured_slice = useCallback(
    async (
      captured_slice: PromptSlice,
      generation: number,
      allow_revision_retry: boolean,
    ): Promise<boolean> => {
      try {
        const result = await commit_project_write({
          operation: CUSTOM_PROMPT_SAVE_WRITE,
          run: async () => {
            return await api_fetch<ProjectWriteResultPayload>("/api/quality/prompts/save", {
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
          prompts_revision_ref.current = read_prompts_revision(
            result.write_result.changes.at(-1)?.sectionRevisions?.prompts,
          );
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
    [commit_project_write, fetch_prompt_snapshot, push_toast, t],
  );

  /** 串行提交最新草稿，在途请求结束后再处理后续编辑。 */
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
      push_toast("warning", t("custom_prompt_page.save.waiting"));
      return false;
    }

    set_save_status("saving");
    const generation = identity_generation_ref.current;
    let write_failed = false;
    const write_promise = (async (): Promise<boolean> => {
      while (
        identity_generation_ref.current === generation &&
        !readonly_ref.current &&
        !are_prompt_slices_equal(desired_ref.current, persisted_ref.current)
      ) {
        const captured_slice = { ...desired_ref.current };
        if (!(await commit_captured_slice(captured_slice, generation, true))) {
          write_failed = true;
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
        if (identity_generation_ref.current === generation) {
          set_save_status(
            are_prompt_slices_equal(desired_ref.current, persisted_ref.current)
              ? "saved"
              : write_failed
                ? "error"
                : "pending",
          );
        }
      }
    }
  }, [commit_captured_slice, readonly, push_toast, t]);

  const debounced_prompt_save = useDebouncedCallback(() => {
    void drain_prompt_change();
  }, CUSTOM_PROMPT_AUTOSAVE_DELAY_MS);

  /** 显式保存与离页先取消防抖，再等待当前草稿收束。 */
  const flush_prompt_change = useCallback(async (): Promise<boolean> => {
    debounced_prompt_save.cancel();
    return await drain_prompt_change();
  }, [debounced_prompt_save, drain_prompt_change]);

  /** 语言变化只刷新模板展示。 */
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

  /** 初始化与重试共同读取模板、正文和提交基线。 */
  const reload_prompt = useCallback(async (): Promise<void> => {
    const generation = ++identity_generation_ref.current;
    debounced_prompt_save.cancel();
    set_save_status("saved");
    if (!project_snapshot.loaded) {
      set_template(EMPTY_PROMPT_TEMPLATE);
      set_prompt_text("");
      set_enabled(false);
      desired_ref.current = EMPTY_PROMPT_SLICE;
      persisted_ref.current = EMPTY_PROMPT_SLICE;
      prompts_revision_ref.current = 0;
      set_load_status("loading");
      return;
    }
    set_load_status("loading");
    try {
      const next_template = await fetch_prompt_template();
      const prompt_snapshot = await fetch_prompt_snapshot();
      if (identity_generation_ref.current !== generation) return;
      const editor_text = prompt_snapshot.slice.text.trim() || next_template.default_text;
      const slice = { text: editor_text.trim(), enabled: prompt_snapshot.slice.enabled };
      set_template(next_template);
      set_prompt_text(editor_text);
      set_enabled(slice.enabled);
      desired_ref.current = slice;
      persisted_ref.current = slice;
      prompts_revision_ref.current = prompt_snapshot.prompts_revision;
      set_load_status("ready");
    } catch {
      if (identity_generation_ref.current === generation) set_load_status("error");
    }
  }, [
    debounced_prompt_save,
    fetch_prompt_snapshot,
    fetch_prompt_template,
    project_snapshot.loaded,
    project_snapshot.path,
  ]);

  useEffect(() => {
    void reload_prompt();
    return () => {
      identity_generation_ref.current += 1;
      debounced_prompt_save.cancel();
    };
  }, [reload_prompt, debounced_prompt_save]);

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

  /** 写入空闲时恢复成功基线并取消待保存任务。 */
  const discard_prompt_change = useCallback((): void => {
    if (write_promise_ref.current !== null) return;
    debounced_prompt_save.cancel();
    desired_ref.current = { ...persisted_ref.current };
    set_prompt_text(persisted_ref.current.text);
    set_enabled(persisted_ref.current.enabled);
    set_save_status("saved");
  }, [debounced_prompt_save]);

  /** 编辑更新期望值，并安排下一次自动保存。 */
  const update_prompt_text = useCallback(
    (next_text: string): void => {
      if (readonly) {
        return;
      }
      set_prompt_text(next_text);
      desired_ref.current = {
        ...desired_ref.current,
        text: next_text.trim(),
      };
      set_save_status(
        write_promise_ref.current !== null
          ? "saving"
          : are_prompt_slices_equal(desired_ref.current, persisted_ref.current)
            ? "saved"
            : "pending",
      );
      debounced_prompt_save.schedule();
    },
    [debounced_prompt_save, readonly],
  );

  /** 导入或预设替换立即保存，失败恢复原草稿。 */
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
        text: next_text.trim(),
      };
      set_prompt_text(next_slice.text);
      desired_ref.current = next_slice;
      const succeeded = await drain_prompt_change();
      if (!succeeded && are_prompt_slices_equal(desired_ref.current, next_slice)) {
        desired_ref.current = previous_slice;
        set_prompt_text(previous_prompt_text);
        set_save_status(
          are_prompt_slices_equal(previous_slice, persisted_ref.current) ? "saved" : "pending",
        );
        if (!are_prompt_slices_equal(previous_slice, persisted_ref.current)) {
          debounced_prompt_save.schedule();
        }
      }
      return succeeded;
    },
    [debounced_prompt_save, drain_prompt_change, prompt_text, readonly],
  );

  /** 开关与最新正文一起保存，成功后确认启用状态。 */
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
        set_save_status(
          are_prompt_slices_equal(previous_slice, persisted_ref.current) ? "saved" : "pending",
        );
        if (!are_prompt_slices_equal(previous_slice, persisted_ref.current)) {
          debounced_prompt_save.schedule();
        }
      }
      return succeeded;
    },
    [config.header_title_key, debounced_prompt_save, drain_prompt_change, push_toast, readonly, t],
  );

  return {
    load_status,
    reload_prompt,
    save_status,
    discard_prompt_change,
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
