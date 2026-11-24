import { useProjectRuntimeSnapshot } from "@frontend/app/state/use-project-runtime";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { PROJECT_KNOWLEDGE_DOCUMENT, type KnowledgeFile } from "@shared/project-knowledge";
import { useProjectFetch } from "@frontend/app/state/use-project-fetch";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { useI18n } from "@frontend/app/locale/locale-context";
import { usePageLeave } from "@frontend/app/navigation/page-leave-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { Card } from "@frontend/shadcn/card";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";
import { AppButton } from "@frontend/widgets/app-button";
import { AppContentState } from "@frontend/widgets/app-content-state";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { DocumentEditorToolbar } from "@frontend/features/document-editor/document-editor-toolbar";
import type { ProjectWriteResult } from "@shared/project-event";
import { useAutosaveDocument } from "@frontend/features/document-editor/use-autosave-document";

/** 工程知识自动保存，重置、离页保存与记录指南共用同一编辑器。 */
export function ProjectKnowledgeEditor({ on_back }: { on_back?: () => void } = {}): JSX.Element {
  const { t } = useI18n();
  const { navigate_to_agent } = useAppNavigation();
  const editor = useProjectKnowledgeEditor();
  const { leaving, register_before_leave } = usePageLeave();
  const [guide_open, set_guide_open] = useState(false);
  useEffect(() => register_before_leave(editor.flush), [editor.flush, register_before_leave]);
  const locked = editor.locked || editor.busy || editor.loading || leaving;
  return (
    <section
      className="document-editor"
      aria-busy={editor.loading}
      onCompositionStart={() => editor.compose(true)}
      onCompositionEnd={() => editor.compose(false)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          if (!locked) void editor.flush();
        }
      }}
    >
      <DocumentEditorToolbar
        path={[PROJECT_KNOWLEDGE_DOCUMENT]}
        action="reset"
        confirm_description={t("knowledge_page.editor.reset_knowledge_confirm")}
        on_action={editor.reset}
        busy={editor.busy || leaving}
        locked={locked || !editor.file}
        status={
          !editor.file
            ? null
            : editor.save_failure === "conflict"
              ? "conflict"
              : editor.save_failure
                ? "save_failed"
                : editor.dirty || editor.saving
                  ? "modified"
                  : "saved"
        }
        on_back={
          on_back
            ? () => {
                void editor.flush().then((ok) => {
                  if (ok) on_back();
                });
              }
            : undefined
        }
        extra={
          <AppButton
            size="sm"
            variant="ghost"
            disabled={editor.busy || leaving}
            onClick={() => set_guide_open(true)}
          >
            {t("knowledge_page.knowledge_create.title")}
          </AppButton>
        }
        recovery={
          editor.save_failure === "conflict" && (
            <div className="document-editor__recovery">
              <AppButton
                size="sm"
                variant="ghost"
                disabled={locked || editor.saving}
                onClick={() => {
                  void editor.recover(false);
                }}
              >
                {t("knowledge_page.editor.discard")}
              </AppButton>
              <AppButton
                size="sm"
                variant="outline"
                disabled={locked || editor.saving}
                onClick={() => {
                  void editor.recover(true);
                }}
              >
                {t("knowledge_page.editor.overwrite")}
              </AppButton>
            </div>
          )
        }
      />
      {editor.file && (
        <Card className="document-editor__content" data-readonly={locked || undefined}>
          <AppEditor
            key={editor.reset_count}
            class_name="document-editor__text"
            aria_label={PROJECT_KNOWLEDGE_DOCUMENT}
            syntax="markdown"
            read_only={locked}
            indent_with_tab
            value={editor.draft}
            on_change={editor.edit}
          />
        </Card>
      )}
      {!editor.file && (
        <AppContentState status={editor.loading ? "loading" : "error"} on_retry={editor.reload} />
      )}
      <AppActionDialog
        open={guide_open}
        description={t("knowledge_page.knowledge_create.description")}
        onClose={() => set_guide_open(false)}
        primaryAction={{
          label: t("app.action.handle_with_agent"),
          onSelect: () => {
            const placeholder = t("knowledge_page.knowledge_create.placeholder");
            const text = t("knowledge_page.knowledge_create.request", { PLACEHOLDER: placeholder });
            const from = text.indexOf(placeholder);
            set_guide_open(false);
            navigate_to_agent({
              text,
              selection: { from, to: from + placeholder.length },
            });
          },
        }}
      />
    </section>
  );
}

/** 编辑器统一使用 LF，草稿和保存基线按同一换行形式比较。 */
function read_knowledge_text(file: KnowledgeFile): string {
  return file.text.replace(/\r\n?/g, "\n");
}

/** 页面只持有当前草稿，指纹冲突与事务写入交给工程服务。 */
function useProjectKnowledgeEditor() {
  const api_fetch = useProjectFetch();
  const { commit_project_write } = useDesktopState();
  const locked = useProjectRuntimeSnapshot().owner !== null;
  const operation = useRef<Promise<boolean> | null>(null); // 暂停自动保存，离页等待同一命令。
  /** 自动保存、覆盖和重置共用工程写入回执。 */
  async function save(file: KnowledgeFile, text: string | null): Promise<KnowledgeFile> {
    const result = await commit_project_write({
      operation: "knowledge.save",
      run: () =>
        api_fetch<ProjectWriteResult & { document: KnowledgeFile }>("/api/project/knowledge/save", {
          fp: file.fp,
          text,
        }),
    });
    return result.payload.document;
  }
  const autosave = useAutosaveDocument<KnowledgeFile>({
    locked,
    read_text: read_knowledge_text,
    paused: () => operation.current !== null,
    save,
  });
  const { current, mounted, update, report, cancel, flush, write } = autosave;
  const replace_document = useCallback(
    (file: KnowledgeFile) =>
      update({
        file,
        draft: read_knowledge_text(file),
        save_failure: null,
        reset_count: current.current.reset_count + 1, // 替换基线后清除旧正文的撤销历史。
      }),
    [current, update],
  );
  /** 读取成功后替换基线，已取消的读取不能覆盖当前草稿。 */
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      update({ loading: true });
      try {
        const file = await api_fetch<KnowledgeFile>("/api/project/knowledge/read", {}, signal);
        if (!signal?.aborted && mounted.current) replace_document(file);
      } catch (error) {
        if (!signal?.aborted && mounted.current) report(error, "load_failed");
      } finally {
        if (!signal?.aborted && mounted.current) update({ loading: false });
      }
    },
    [api_fetch, mounted, replace_document, update, report],
  );
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);
  /** 命令接管自动保存，等待在途写入后读取最新指纹。 */
  async function run(action: (file: KnowledgeFile) => Promise<void>) {
    if (operation.current || locked) return false;
    cancel();
    update({ busy: true });
    const pending = (async () => {
      await write.current;
      const latest = await api_fetch<KnowledgeFile>("/api/project/knowledge/read", {});
      await action(latest);
      return true;
    })().catch((error: unknown) => {
      report(error);
      return false;
    });
    operation.current = pending;
    try {
      return await pending;
    } finally {
      operation.current = null;
      update({ busy: false });
    }
  }
  /** 先等待文档命令，再判断最新草稿是否已保存。 */
  const finish = useCallback(async () => {
    if (operation.current && !(await operation.current)) return false;
    return flush();
  }, [flush]);
  return {
    ...autosave.state,
    dirty: autosave.dirty,
    locked,
    edit: autosave.edit,
    compose: autosave.compose,
    flush: finish,
    reload: () => reload(),
    reset: () =>
      run(async (latest) => {
        replace_document(await save(latest, null));
      }),
    /** 放弃时换成最新正文，覆盖时以最新指纹重新保存草稿。 */
    recover: (overwrite: boolean) =>
      run(async (latest) => {
        if (!overwrite) {
          replace_document(latest);
          return;
        }
        const draft = current.current.draft;
        const file = draft === read_knowledge_text(latest) ? latest : await save(latest, draft);
        update({ file, draft: read_knowledge_text(file), save_failure: null });
      }),
  };
}
