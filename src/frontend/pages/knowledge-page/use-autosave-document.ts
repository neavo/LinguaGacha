import { useCallback, useEffect, useRef, useState } from "react";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";

export const DOCUMENT_AUTOSAVE_DELAY_MS = 1000;

export type DocumentEditorState<File> = {
  file: File | null;
  draft: string;
  reset_count: number; // 放弃草稿后重建编辑器，清除旧撤销历史。
  loading: boolean;
  busy: boolean;
  saving: boolean;
  composing: boolean;
  save_failure: "failed" | "conflict" | null; // 失败暂停自动重试，冲突提供显式恢复入口。
};

/** 文档草稿与保存基线共用串行循环，文件命令通过暂停和等待在途写入接管草稿。 */
export function useAutosaveDocument<File>(options: {
  initial?: Partial<DocumentEditorState<File>>;
  locked: boolean;
  read_text: (file: File) => string;
  save: (file: File, draft: string) => Promise<File>;
  can_save?: (file: File, draft: string) => boolean;
  readonly?: (file: File) => boolean;
  paused?: () => boolean;
  equal?: (left: string, right: string) => boolean;
}) {
  const { t } = useI18n();
  const environment = useRef({ ...options, t }); // 在途保存读取最新占用和语言。
  environment.current = { ...options, t };
  const [state, set_state] = useState<DocumentEditorState<File>>(() => ({
    file: null,
    draft: "",
    reset_count: 0,
    loading: true,
    busy: false,
    saving: false,
    composing: false,
    save_failure: null,
    ...options.initial,
  }));
  const current = useRef(state); // 同步保留最新草稿，避免在途请求覆盖后续输入。
  const mounted = useRef(false); // 本 Hook 独占挂载状态，调用方只读取。
  const write = useRef<Promise<boolean> | null>(null); // 自动保存、文件命令与离页等待同一写入。
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 同步刷新异步操作读取的状态和页面展示。 */
  const update = useCallback((patch: Partial<DocumentEditorState<File>>) => {
    current.current = { ...current.current, ...patch };
    if (mounted.current) set_state(current.current);
  }, []);
  /** 显式保存和文件命令接管尚未开始的自动保存。 */
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  /** 保存失败保留草稿，加载失败只通知当前读取结果。 */
  const report = useCallback(
    (error: unknown, context: "load_failed" | "save_failed" = "save_failed") => {
      if (context === "save_failed")
        update({
          save_failure:
            error instanceof DesktopApiError && error.code === "data.revision_conflict"
              ? "conflict"
              : "failed",
        });
      push_error_toast(environment.current.t(`app.feedback.${context}`), error);
    },
    [update],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);
  /** 串行提交到保存基线追上草稿，调用方可据返回值阻止离页。 */
  const flush = useCallback(async (): Promise<boolean> => {
    cancel();
    if (write.current) return write.current;
    /** 每次请求结束后重新检查输入和占用，删除或重置可接管后续草稿。 */
    const run = async () => {
      update({ save_failure: null });
      while (mounted.current) {
        const env = environment.current;
        if (env.paused?.()) return true;
        const { file, draft, composing } = current.current;
        if (composing) return false;
        if (!file || env.readonly?.(file) || (env.equal ?? Object.is)(draft, env.read_text(file)))
          return true;
        if (env.locked || (env.can_save && !env.can_save(file, draft))) return false;
        update({ saving: true });
        try {
          const saved = await env.save(file, draft);
          if (!mounted.current) return false;
          update({
            file: saved,
            ...(current.current.draft === draft
              ? { draft: environment.current.read_text(saved) }
              : {}),
          });
        } catch (error) {
          if (mounted.current) report(error);
          return false;
        }
      }
      return false;
    };
    const pending = run();
    write.current = pending;
    try {
      return await pending;
    } finally {
      write.current = null;
      if (mounted.current) update({ saving: false });
    }
  }, [cancel, report, update]);
  const dirty =
    state.file !== null &&
    !(options.equal ?? Object.is)(state.draft, options.read_text(state.file));
  const valid =
    state.file === null || !options.can_save || options.can_save(state.file, state.draft);
  useEffect(() => {
    if (
      dirty &&
      valid &&
      !options.locked &&
      !state.loading &&
      !state.busy &&
      !state.saving &&
      !state.composing &&
      !state.save_failure
    )
      timer.current = setTimeout(() => {
        void flush();
      }, DOCUMENT_AUTOSAVE_DELAY_MS);
    return cancel;
  }, [state, dirty, valid, options.locked, cancel, flush]);
  return {
    state,
    current,
    mounted,
    write,
    update,
    cancel,
    report,
    flush,
    dirty,
    /** 新输入解除错误暂停，重新启动自动保存。 */
    edit: (draft: string) => {
      if (!environment.current.locked && !current.current.busy && !current.current.loading)
        update({ draft, save_failure: null });
    },
    /** 输入法组词期间取消倒计时，结束后再保存完整输入。 */
    compose: (composing: boolean) => {
      if (composing) cancel();
      update({ composing });
    },
  };
}
