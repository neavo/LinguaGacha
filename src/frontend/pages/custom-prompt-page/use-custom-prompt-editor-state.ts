import { push_error_toast, push_toast, dismiss_toast } from "@frontend/app/feedback/desktop-toast";
import { useCallback, useEffect, useRef, useState } from "react";

import { api_fetch, DesktopApiError } from "@frontend/app/desktop/desktop-api";

import { useI18n } from "@frontend/app/locale/locale-context";
import type {
  ProjectWriteOperation,
  ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import type { CustomPromptTemplate } from "@frontend/pages/custom-prompt-page/types";
import { useDebouncedCallback } from "@frontend/widgets/interactions/use-debounce";
import { AppError } from "@shared/error";

type PromptSlice = {
  text: string | null;
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

  template: CustomPromptTemplate;
  prompt_text: string;
  enabled: boolean;
  readonly: boolean;
  update_prompt_text: (next_text: string) => void;
  update_enabled: (next_enabled: boolean) => Promise<boolean>;
  replace_prompt_text: (next_text: string | null) => Promise<boolean>;
  flush_prompt_change: () => Promise<boolean>;
};

const CUSTOM_PROMPT_SAVE_WRITE: ProjectWriteOperation = "custom-prompt.prompt_save";
export const CUSTOM_PROMPT_AUTOSAVE_DELAY_MS = 1000;

const EMPTY_PROMPT_TEMPLATE: CustomPromptTemplate = {
  default_text: "",
  prefix_text: "",
  suffix_text: "",
};
const EMPTY_PROMPT_SLICE: PromptSlice = { text: null, enabled: false };

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

/** 忽略正文首尾空白，但 null 与空字符串仍代表不同覆盖身份。 */
function are_prompt_texts_equal(left: string | null, right: string | null): boolean {
  return left?.trim() === right?.trim();
}

/** 正文覆盖与启用态共同决定是否需要提交。 */
function are_prompt_slices_equal(left: PromptSlice, right: PromptSlice): boolean {
  return are_prompt_texts_equal(left.text, right.text) && left.enabled === right.enabled;
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
export function useCustomPromptEditorState(): UseCustomPromptEditorStateResult {
  const { t } = useI18n();

  const { project_snapshot, settings_snapshot, commit_project_write } = useDesktopState();
  const runtime_snapshot = useRuntimeSnapshot();
  const [load_status, set_load_status] = useState<"loading" | "ready" | "error">("loading");
  const readonly = is_runtime_busy(runtime_snapshot) || load_status !== "ready";

  const [template, set_template] = useState<CustomPromptTemplate>(EMPTY_PROMPT_TEMPLATE);
  const [prompt_text, set_prompt_text] = useState<string | null>(null); // 编辑缓冲保留空白，保存意图由 desired_ref 持有。
  const [enabled, set_enabled] = useState(false);
  const desired_ref = useRef<PromptSlice>(EMPTY_PROMPT_SLICE); // 当前编辑意图，每次编辑替换整个值。
  const persisted_ref = useRef<PromptSlice>(EMPTY_PROMPT_SLICE); // 仅成功查询或写入推进保存基线。
  const prompts_revision_ref = useRef(0); // 下一次写入使用后端确认的乐观锁 revision。
  const write_promise_ref = useRef<{
    generation: number;
    promise: Promise<boolean>;
  } | null>(null);
  const identity_generation_ref = useRef(0); // 项目切换与卸载隔离旧查询和在途写入回包。
  const previous_app_language_ref = useRef(settings_snapshot.app_language);
  const readonly_ref = useRef(readonly); // 异步保存读取最新占用状态，Effect 也借此识别解锁。
  const save_error_toast_ref = useRef<ReturnType<typeof push_error_toast> | null>(null); // 保存恢复通知随当前尝试和页面生命周期失效。

  /** 关闭恢复通知并使已排队的旧点击失效。 */
  const clear_save_error = useCallback((): void => {
    if (save_error_toast_ref.current !== null) {
      dismiss_toast(save_error_toast_ref.current);
      save_error_toast_ref.current = null;
    }
  }, []);

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
        text: payload.prompt?.text ?? null,
        enabled: Boolean(payload.prompt?.enabled),
      },
      prompts_revision: read_prompts_revision(payload.sectionRevisions?.prompts),
    };
  }, []);

  // 回调在防抖触发时读取本轮保存入口，声明顺序不参与执行顺序。
  const debounced_prompt_save = useDebouncedCallback(() => {
    void drain_prompt_change();
  }, CUSTOM_PROMPT_AUTOSAVE_DELAY_MS);

  /** 保存开始和项目切换都会清除通知身份，撤销仅处理当前失败留下的草稿。 */
  const notify_save_error = useCallback(
    (error: unknown, generation: number): void => {
      if (identity_generation_ref.current !== generation) return;
      const toast_id = push_error_toast(t("app.feedback.save_failed"), error, {
        action: {
          label: t("custom_prompt_page.save.discard"),
          onClick: () => {
            if (save_error_toast_ref.current !== toast_id) return;
            debounced_prompt_save.cancel();
            clear_save_error();
            desired_ref.current = persisted_ref.current;
            set_prompt_text(persisted_ref.current.text);
            set_enabled(persisted_ref.current.enabled);
          },
        },
      });
      save_error_toast_ref.current = toast_id;
    },
    [clear_save_error, debounced_prompt_save, t],
  );

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
            notify_save_error(refresh_error, generation);
            return false;
          }
        }
        notify_save_error(error, generation);
        return false;
      }
    },
    [commit_project_write, fetch_prompt_snapshot, notify_save_error],
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
    clear_save_error();
    if (are_prompt_slices_equal(desired_ref.current, persisted_ref.current)) {
      return true;
    }
    if (readonly) {
      push_toast("warning", t("custom_prompt_page.save.waiting"));
      return false;
    }

    const generation = identity_generation_ref.current;
    const write_promise = (async (): Promise<boolean> => {
      while (
        identity_generation_ref.current === generation &&
        !readonly_ref.current &&
        !are_prompt_slices_equal(desired_ref.current, persisted_ref.current)
      ) {
        const desired = desired_ref.current;
        const persisted = persisted_ref.current;
        const captured_slice = {
          ...desired,
          // 只提交开关变化时保留持久化原文，避免顺带改写首尾空白。
          text: are_prompt_texts_equal(desired.text, persisted.text)
            ? persisted.text
            : desired.text,
        };
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
  }, [clear_save_error, commit_captured_slice, readonly, t]);

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
        if (desired_ref.current.text === null) set_prompt_text(null);
      }
    } catch (error) {
      if (identity_generation_ref.current === generation) {
        push_error_toast(t("app.feedback.load_failed"), error);
      }
    }
  }, [fetch_prompt_template, t]);

  /** 初始化与重试共同读取模板、正文和提交基线。 */
  const reload_prompt = useCallback(async (): Promise<void> => {
    const generation = ++identity_generation_ref.current;
    clear_save_error();
    debounced_prompt_save.cancel();

    if (!project_snapshot.loaded) {
      set_template(EMPTY_PROMPT_TEMPLATE);
      set_prompt_text(null);
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
      const slice = prompt_snapshot.slice;
      set_template(next_template);
      set_prompt_text(slice.text);
      set_enabled(slice.enabled);
      desired_ref.current = slice;
      persisted_ref.current = slice;
      prompts_revision_ref.current = prompt_snapshot.prompts_revision;
      set_load_status("ready");
    } catch (error) {
      if (identity_generation_ref.current === generation) {
        set_load_status("error");
        push_error_toast(t("app.feedback.load_failed"), error);
      }
    }
  }, [
    clear_save_error,
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
      clear_save_error();
      debounced_prompt_save.cancel();
    };
  }, [clear_save_error, reload_prompt, debounced_prompt_save]);

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
    const was_readonly = readonly_ref.current;
    readonly_ref.current = readonly;
    if (readonly) {
      debounced_prompt_save.cancel();
      return;
    }
    if (was_readonly && !are_prompt_slices_equal(desired_ref.current, persisted_ref.current)) {
      debounced_prompt_save.schedule();
    }
  }, [debounced_prompt_save, readonly]);

  /** 编辑更新期望值，并安排下一次自动保存。 */
  const update_prompt_text = useCallback(
    (next_text: string): void => {
      if (readonly) {
        return;
      }
      set_prompt_text(next_text);
      if (next_text.trim() === (desired_ref.current.text ?? template.default_text).trim()) return;
      desired_ref.current = {
        ...desired_ref.current,
        // 尚未保存覆盖时撤销回默认正文，继续保留继承状态。
        text:
          persisted_ref.current.text === null &&
          are_prompt_texts_equal(next_text, template.default_text)
            ? null
            : next_text,
      };

      debounced_prompt_save.schedule();
    },
    [debounced_prompt_save, readonly, template.default_text],
  );

  /** 导入或预设替换立即保存，失败恢复原草稿。 */
  const replace_prompt_text = useCallback(
    async (next_text: string | null): Promise<boolean> => {
      if (readonly) {
        return false;
      }
      debounced_prompt_save.cancel();
      const previous_slice = desired_ref.current;
      const previous_prompt_text = prompt_text;
      const next_slice = {
        ...previous_slice,
        text: next_text,
      };
      set_prompt_text(next_slice.text);
      desired_ref.current = next_slice;
      const succeeded = await drain_prompt_change();
      if (!succeeded && desired_ref.current === next_slice) {
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
      } else if (desired_ref.current === next_slice) {
        desired_ref.current = previous_slice;

        if (!are_prompt_slices_equal(previous_slice, persisted_ref.current)) {
          debounced_prompt_save.schedule();
        }
      }
      return succeeded;
    },
    [debounced_prompt_save, drain_prompt_change, readonly],
  );

  return {
    load_status,
    reload_prompt,
    template,
    prompt_text: prompt_text ?? template.default_text,
    enabled,
    readonly,
    update_prompt_text,
    update_enabled,
    replace_prompt_text,
    flush_prompt_change,
  };
}
