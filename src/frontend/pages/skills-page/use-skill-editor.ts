import { AGENT_SKILL_MAIN_FILE } from "@shared/agent-skills";
import { useCallback, useEffect, useRef, useState } from "react";
import { api_fetch, DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { useI18n } from "@frontend/app/locale/locale-context";
import {
  validate_agent_skill_document,
  type AgentSkillFile,
  type AgentSkillFileChange,
  type AgentSkillIdentity,
  type AgentSkillTree,
} from "@shared/agent-skills";
import {
  SKILL_AUTOSAVE_DELAY_MS,
  format_skill_editor_document,
  read_skill_editor_document,
} from "./skill-editor-document";

type EditorState = {
  tree: AgentSkillTree | null;
  file: AgentSkillFile | null;
  draft: string;
  reset_count: number; // 明确放弃修改时重建编辑器，清除旧撤销历史。
  loading: boolean;
  busy: boolean;
  saving: boolean;
  composing: boolean;
  error: string;
  conflict: boolean;
};
/** 草稿和保存基线统一使用 LF，与编辑器的逻辑行表示一致。 */
function file_draft(file: AgentSkillFile): string {
  return file.document
    ? format_skill_editor_document(file.document)
    : (file.text ?? "").replace(/\r\n?/g, "\n");
}

/** 只持有当前文件草稿。切换先保存，文件命令与自动保存共享同一在途请求。 */
export function useSkillEditor(identity: AgentSkillIdentity) {
  const { t } = useI18n();
  const locked = useRuntimeSnapshot().owner === "agent";
  const locked_ref = useRef(locked); // 在途保存和离页回调读取最新运行占用。
  locked_ref.current = locked;
  const translate = useRef(t); // 语言变化只更新错误文案，不重新加载并覆盖草稿。
  useEffect(() => {
    translate.current = t;
  }, [t]);
  const [state, set_state] = useState<EditorState>({
    tree: null,
    file: null,
    draft: "",
    reset_count: 0,
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null); // 离页和文件操作接管尚未触发的自动保存。
  const reading = useRef<AbortController | null>(null); // 重试和 StrictMode 重挂载失效旧查询。
  const deleting = useRef(false); // 删除接管草稿后，正在保存的循环只完成当前请求。
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
  /** 文件命令的失败通过通知反馈，不占用正文保存的恢复状态。 */
  const notify = useCallback((error: unknown) => {
    const text = translate.current;
    push_toast(
      "error",
      error instanceof DesktopApiError && error.code === "file.already_exists"
        ? text("skills_page.feedback.duplicate_name")
        : resolve_visible_error_message(error, text, text("skills_page.feedback.operation_failed")),
    );
  }, []);

  /** 初始化和重试共用读取流程，取消旧查询后才接收新结果。 */
  const load = useCallback(async () => {
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    update({ loading: true, error: "" });
    try {
      const skill = current.current.file?.skill ?? current.current.tree?.skill ?? identity;
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
    /** 每轮提交前重新检查组词和字段状态。 */
    const run = async (): Promise<boolean> => {
      update({ error: "", conflict: false });
      while (mounted.current) {
        if (deleting.current) return true;
        if (current.current.composing) return false;
        const { file, draft } = current.current;
        if (!file || file.skill.source === "builtin" || draft === file_draft(file)) return true;
        if (locked_ref.current) return false;
        const document = file.document ? read_skill_editor_document(draft) : undefined;
        if (document && validate_agent_skill_document(document)) return false;
        update({ saving: true });
        try {
          const saved = await api_fetch<AgentSkillFile>("/api/skills/file/save", {
            ...file.skill,
            path: file.path,
            revision: file.revision,
            ...(document ? { document } : { text: draft }),
          });
          if (!mounted.current) return false;
          update({
            file: saved,
            ...(current.current.draft === draft ? { draft: file_draft(saved) } : {}),
            tree: current.current.tree ? { ...current.current.tree, skill: saved.skill } : null,
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

  const dirty = state.file !== null && state.draft !== file_draft(state.file);
  const invalid = state.file?.document
    ? validate_agent_skill_document(read_skill_editor_document(state.draft))
    : null;
  // 文件命令可能在同次 React 提交内结束，仍需按最新状态恢复被接管的保存计时。
  useEffect(() => {
    if (
      !locked &&
      dirty &&
      !invalid &&
      !state.composing &&
      !state.busy &&
      !state.saving &&
      !state.error
    )
      timer.current = setTimeout(() => {
        void flush();
      }, SKILL_AUTOSAVE_DELAY_MS);
    return cancel;
  }, [state, dirty, invalid, locked, cancel, flush]);

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

  /** 递归删除失败可能已经移除部分文件；刷新结构，只替换已不存在文件的编辑基线。 */
  async function refresh_after_delete_failure(skill: AgentSkillIdentity): Promise<boolean> {
    let tree: AgentSkillTree;
    try {
      tree = await api_fetch<AgentSkillTree>("/api/skills/tree", skill);
    } catch (error) {
      if (!(error instanceof DesktopApiError) || error.code !== "file.not_found") throw error;
      update({ file: null, tree: null, draft: "", error: "", conflict: false });
      return true;
    }
    update({ tree });
    const current_file = current.current.file;
    if (
      current_file &&
      tree.entries.some((entry) => entry.kind === "file" && entry.path === current_file.path)
    )
      return false;
    // 旧文件已被删除，先停止其自动保存；主文件读取失败时由页面提供重载。
    update({ file: null });
    const file = await api_fetch<AgentSkillFile>("/api/skills/file/read", {
      ...tree.skill,
      path: AGENT_SKILL_MAIN_FILE,
    });
    update({
      file,
      draft: file_draft(file),
      error: "",
      conflict: false,
      reset_count: current.current.reset_count + 1,
    });
    return false;
  }

  /** 文件命令成功后更新导航。当前路径未受影响时沿用已保存内容。 */
  async function change_file(change: AgentSkillFileChange): Promise<boolean> {
    if (locked_ref.current) return false;
    const affected =
      current.current.file &&
      (current.current.file.path === change.path ||
        current.current.file.path.startsWith(`${change.path}/`));
    // 删除已获确认，等待在途保存后直接处理目标草稿。
    if (change.operation === "delete" && affected) {
      if (write.current) await write.current;
    } else if (!(await flush())) {
      const invalid = current.current.file?.document
        ? validate_agent_skill_document(read_skill_editor_document(current.current.draft))
        : null;
      push_toast(
        "error",
        current.current.error ||
          (invalid
            ? translate.current(`skills_page.editor.invalid_${invalid}`)
            : translate.current("skills_page.feedback.save_failed")),
      );
      return false;
    }
    const previous = current.current.file;
    if (!previous) return false;
    let tree: AgentSkillTree;
    try {
      tree = await api_fetch<AgentSkillTree>("/api/skills/file/change", {
        ...previous.skill,
        ...change,
      });
    } catch (error) {
      if (change.operation === "delete") {
        try {
          await refresh_after_delete_failure(previous.skill);
        } catch (refresh) {
          report(refresh, "load_failed");
        }
      }
      throw error;
    }
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
    if (change.operation === "move") {
      // 移动后复用已保存正文与版本，并更新当前路径。
      update({ file: { ...previous, skill: tree.skill, path: next_path } });
      return true;
    }
    try {
      const file = await api_fetch<AgentSkillFile>("/api/skills/file/read", {
        ...tree.skill,
        path: next_path,
      });
      update({ file, draft: file_draft(file), error: "", conflict: false });
    } catch (error) {
      // 文件命令已经完成。读取失败进入页面重载，避免重复执行创建或删除。
      update({ file: null });
      report(error, "load_failed");
    }
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
    update({
      file,
      error: "",
      conflict: false,
      ...(!overwrite
        ? { draft: file_draft(file), reset_count: current.current.reset_count + 1 }
        : {}),
    });
    return overwrite ? await flush() : true;
  }

  /** 文件操作的互斥、错误和忙碌状态由同一个入口拥有。 */
  const run_operation = useCallback(
    async (
      action: () => Promise<boolean>,
      context: "load_failed" | "file_operation",
    ): Promise<boolean> => {
      if (operation.current) return false;
      cancel();
      update({ busy: true });
      const pending = action().catch((error: unknown) => {
        if (context === "file_operation") notify(error);
        else report(error, context);
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
    [cancel, notify, report, update],
  );
  /** 离页等待文件命令及最新草稿落盘，失败时保留当前工作面。 */
  const finish = useCallback(async (): Promise<boolean> => {
    if (operation.current && !(await operation.current)) return false;
    return await flush();
  }, [flush]);

  return {
    ...state,
    dirty,
    locked,
    invalid,
    reload: load,
    flush: finish,
    delete_skill: () =>
      run_operation(async () => {
        if (locked_ref.current) return false;
        deleting.current = true;
        try {
          if (write.current) await write.current;
          const file = current.current.file;
          if (!file) return false;
          await api_fetch("/api/skills/delete", file.skill);
          // 删除成功后清除保存基线，离页和延迟回调都无法重新写入旧包。
          update({ file: null, tree: null, draft: "", error: "", conflict: false });
          return true;
        } catch (error) {
          notify(error);
          const skill = current.current.file?.skill;
          if (skill) {
            try {
              return await refresh_after_delete_failure(skill);
            } catch (refresh) {
              report(refresh, "load_failed");
            }
          }
          return false;
        } finally {
          deleting.current = false;
        }
      }, "file_operation"),
    open_file: (path: string) => run_operation(() => open_file(path), "load_failed"),
    change_file: (change: AgentSkillFileChange) =>
      run_operation(() => change_file(change), "file_operation"),
    recover: (overwrite = false) => run_operation(() => recover(overwrite), "load_failed"),
    /** 输入更新草稿后清除上一次保存错误，恢复自动保存。 */
    edit: (draft: string) => {
      if (!locked_ref.current && !current.current.busy)
        update({ draft, error: "", conflict: false });
    },
    /** 组词开始时取消待保存任务，结束后由草稿监听恢复计时。 */
    compose: (composing: boolean) => {
      if (composing) cancel();
      update({ composing });
    },
  };
}
