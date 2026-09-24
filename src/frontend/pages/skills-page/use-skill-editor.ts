import { AGENT_SKILL_MAIN_FILE } from "@shared/agent-skills";
import { useCallback, useEffect, useRef, useState } from "react";
import { api_fetch, DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";
import {
  validate_agent_skill_document,
  type AgentSkillFile,
  type AgentSkillDocument,
  type AgentSkillFileChange,
  type AgentSkillIdentity,
  type AgentSkillTree,
} from "@shared/agent-skills";

export const SKILL_AUTOSAVE_DELAY_MS = 1000;
type Draft = { text: string; document?: AgentSkillDocument };
type EditorState = {
  tree: AgentSkillTree | null;
  file: AgentSkillFile | null;
  draft: Draft;
  loading: boolean;
  busy: boolean;
  saving: boolean;
  composing: boolean;
  error: string;
  conflict: boolean;
};
/** 保存回包提供新的编辑基线，主文件草稿沿用解析后的正文。 */
function file_draft(file: AgentSkillFile): Draft {
  return { text: file.text ?? "", document: file.document };
}
/** 主文件按表单与正文比较，普通文件按完整文本比较。 */
function same_draft(a: Draft, b: Draft): boolean {
  return a.document && b.document
    ? a.document.name === b.document.name &&
        a.document.description === b.document.description &&
        a.document.body === b.document.body
    : a.text === b.text;
}

/** 只持有当前文件草稿。切换先保存，文件命令与自动保存共享同一在途请求。 */
export function useSkillEditor(identity: AgentSkillIdentity) {
  const { t } = useI18n();
  const translate = useRef(t); // 语言变化只更新错误文案，不重新加载并覆盖草稿。
  useEffect(() => {
    translate.current = t;
  }, [t]);
  const [state, set_state] = useState<EditorState>({
    tree: null,
    file: null,
    draft: { text: "" },
    loading: true,
    busy: false,
    saving: false,
    composing: false,
    error: "",
    conflict: false,
  });
  const current = useRef(state); // 异步回调读取最新输入，避免捕获旧渲染。
  const mounted = useRef(false); // 卸载后停止向页面发布请求结果。
  const write = useRef<Promise<boolean> | null>(null); // 保存和文件操作共同等待同一写入。
  const operation = useRef<Promise<boolean> | null>(null); // 离页同时等待文件操作，错误留在当前工作面。
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reading = useRef<AbortController | null>(null); // 重试和 StrictMode 重挂载失效旧查询。
  /** 同步刷新异步操作读取的状态和 React 展示。 */
  const update = useCallback((patch: Partial<EditorState>) => {
    current.current = { ...current.current, ...patch };
    if (mounted.current) set_state(current.current);
  }, []);
  /** 文件操作或离页立即接管尚未触发的自动保存。 */
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  /** 错误反馈使用当前语言，并保留版本冲突的恢复入口。 */
  const report = useCallback(
    (error: unknown, context: "load_failed" | "save_failed" = "save_failed") => {
      const text = translate.current;
      update({
        error: resolve_visible_error_message(error, text, text(`skills_page.feedback.${context}`)),
        conflict: error instanceof DesktopApiError && error.code === "data.revision_conflict",
      });
    },
    [update],
  );

  /** 初始化和重试共用读取流程，取消旧查询后才接收新结果。 */
  const load = useCallback(async () => {
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    update({ loading: true, error: "" });
    try {
      const skill = current.current.file?.skill ?? identity;
      const tree = await api_fetch<AgentSkillTree>("/api/skills/tree", skill, controller.signal);
      const file = await api_fetch<AgentSkillFile>(
        "/api/skills/file/read",
        {
          ...skill,
          path: AGENT_SKILL_MAIN_FILE,
        },
        controller.signal,
      );
      if (mounted.current && !controller.signal.aborted)
        update({ tree, file, draft: file_draft(file), loading: false });
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        report(error, "load_failed");
        update({ loading: false });
      }
    }
  }, [identity, report, update]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      reading.current?.abort();
      cancel();
    };
  }, [load, cancel]);

  /** 串行保存最新草稿，在途编辑继续提交直到成功基线追上输入。 */
  const flush = useCallback(async (): Promise<boolean> => {
    cancel();
    if (write.current) return await write.current;
    /** 每轮提交前重新检查组词和表单状态。 */
    const run = async (): Promise<boolean> => {
      update({ error: "", conflict: false });
      while (mounted.current) {
        if (current.current.composing) return false;
        const { file, draft } = current.current;
        if (!file || file.skill.source === "builtin" || same_draft(draft, file_draft(file)))
          return true;
        if (draft.document && validate_agent_skill_document(draft.document)) return false;
        update({ saving: true });
        try {
          const saved = await api_fetch<AgentSkillFile>("/api/skills/file/save", {
            ...file.skill,
            path: file.path,
            revision: file.revision,
            ...draft,
          });
          if (!mounted.current) return false;
          const renamed = saved.skill.name !== file.skill.name;
          update({
            file: saved,
            ...(same_draft(current.current.draft, draft) ? { draft: file_draft(saved) } : {}),
            tree: current.current.tree ? { ...current.current.tree, skill: saved.skill } : null,
          });
          if (renamed) push_toast("success", t("skills_page.feedback.next_conversation"));
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
  }, [cancel, report, t, update]);

  const dirty = state.file !== null && !same_draft(state.draft, file_draft(state.file));
  const invalid = state.draft.document ? validate_agent_skill_document(state.draft.document) : null;
  useEffect(() => {
    if (dirty && !invalid && !state.composing && !state.busy && !state.error)
      timer.current = setTimeout(() => {
        void flush();
      }, SKILL_AUTOSAVE_DELAY_MS);
    return cancel;
  }, [state.draft, state.composing, state.busy, state.error, dirty, invalid, cancel, flush]);

  /** 切换前保存当前草稿，成功读取后才替换编辑内容。 */
  async function open_file(relative: string): Promise<boolean> {
    if (!(await flush())) return false;
    const skill = current.current.file?.skill;
    if (!skill) return false;
    const file = await api_fetch<AgentSkillFile>("/api/skills/file/read", {
      ...skill,
      path: relative,
    });
    update({ file, draft: file_draft(file) });
    return true;
  }

  /** 文件命令成功后更新导航。当前路径未受影响时沿用已保存内容。 */
  async function change_file(change: AgentSkillFileChange): Promise<boolean> {
    const affected =
      current.current.file &&
      (current.current.file.path === change.path ||
        current.current.file.path.startsWith(`${change.path}/`));
    // 删除已获确认，等待在途保存后直接处理目标草稿。
    if (change.operation === "delete" && affected) {
      if (write.current) await write.current;
    } else if (!(await flush())) return false;
    const previous = current.current.file;
    if (!previous) return false;
    const tree = await api_fetch<AgentSkillTree>("/api/skills/file/change", {
      ...previous.skill,
      ...change,
    });
    update({ tree });
    const next_path =
      change.operation === "create_file"
        ? change.path
        : affected && change.operation === "delete"
          ? AGENT_SKILL_MAIN_FILE
          : affected && change.operation === "move"
            ? change.destination + previous.path.slice(change.path.length)
            : previous.path;
    if (next_path === previous.path) return true;
    const file = await api_fetch<AgentSkillFile>("/api/skills/file/read", {
      ...tree.skill,
      path: next_path,
    });
    update({ file, draft: file_draft(file), error: "", conflict: false });
    return true;
  }

  /** 覆盖前取得当前磁盘版本，后续保存继续使用版本检查。 */
  async function recover(overwrite: boolean): Promise<boolean> {
    if (write.current && !(await write.current)) return false;
    const old = current.current.file;
    if (!old) return false;
    const file = await api_fetch<AgentSkillFile>("/api/skills/file/read", {
      ...old.skill,
      path: old.path,
    });
    update({ file, ...(!overwrite ? { draft: file_draft(file) } : {}) });
    return overwrite ? await flush() : true;
  }

  /** 文件操作的互斥、错误和忙碌状态由同一个入口拥有。 */
  const run_operation = useCallback(
    async (
      action: () => Promise<boolean>,
      context: "load_failed" | "save_failed" = "save_failed",
    ): Promise<boolean> => {
      if (operation.current) return false;
      cancel();
      update({ busy: true, error: "", conflict: false });
      const pending = action().catch((error: unknown) => {
        report(error, context);
        return false;
      });
      operation.current = pending;
      try {
        return await pending;
      } finally {
        operation.current = null;
        update({ busy: false });
      }
    },
    [cancel, report, update],
  );
  /** 离页等待文件命令及最新草稿落盘，失败时保留当前工作面。 */
  const finish = useCallback(async (): Promise<boolean> => {
    if (operation.current && !(await operation.current)) return false;
    return await flush();
  }, [flush]);

  return {
    ...state,
    dirty,
    invalid,
    reload: load,
    flush: finish,
    open_file: (path: string) => run_operation(() => open_file(path), "load_failed"),
    change_file: (change: AgentSkillFileChange) => run_operation(() => change_file(change)),
    recover: (overwrite = false) => run_operation(() => recover(overwrite), "load_failed"),
    edit: (draft: Draft) => update({ draft, error: "", conflict: false }),
    compose: (composing: boolean) => {
      if (composing) cancel();
      update({ composing });
    },
  };
}
