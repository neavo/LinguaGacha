import { type JSX, useCallback, useEffect, useRef } from "react";
import { PROJECT_KNOWLEDGE_DOCUMENT, type KnowledgeFile } from "@shared/project-knowledge";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { useI18n } from "@frontend/app/locale/locale-context";
import { usePageLeave } from "@frontend/app/navigation/page-leave-context";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { Card } from "@frontend/shadcn/card";
import { AppButton } from "@frontend/widgets/app-button";
import { AppContentState } from "@frontend/widgets/app-content-state";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { DocumentEditorToolbar } from "./document-editor-toolbar";
import type { ProjectWriteResult } from "@shared/project-event";
import { useAutosaveDocument } from "./use-autosave-document";

/** 每个工程只有一篇知识，随工程建立且不能删除，自动保存接入离页流程。 */
export function ProjectKnowledgeEditor({ on_back }: { on_back: () => void }): JSX.Element {
  const { t } = useI18n();
  const editor = useProjectKnowledgeEditor();
  const { leaving, register_before_leave } = usePageLeave();
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
        on_back={() => {
          void editor.flush().then((ok) => {
            if (ok) on_back();
          });
        }}
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
    </section>
  );
}

/** 页面只持有当前草稿，指纹冲突与事务写入交给工程服务。 */
function useProjectKnowledgeEditor() {
  const { commit_project_write } = useDesktopState();
  const locked = useRuntimeSnapshot().owner !== null;
  const operation = useRef<Promise<boolean> | null>(null); // 离页等待冲突恢复命令。
  const autosave = useAutosaveDocument<KnowledgeFile>({
    locked,
    read_text: (file) => file.text.replace(/\r\n?/g, "\n"),
    save: async (file, draft) => {
      const result = await commit_project_write({
        operation: "knowledge.save",
        run: () =>
          api_fetch<ProjectWriteResult & { document: KnowledgeFile }>(
            "/api/project/knowledge/save",
            { fp: file.fp, text: draft },
          ),
      });
      return result.payload.document;
    },
  });
  const { current, mounted, update, report, cancel, flush, write } = autosave;
  /** 读取成功后替换基线，已取消的读取不能覆盖当前草稿。 */
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      update({ loading: true });
      try {
        const file = await api_fetch<KnowledgeFile>("/api/project/knowledge/read", {}, signal);
        if (!signal?.aborted && mounted.current)
          update({
            file,
            draft: file.text.replace(/\r\n?/g, "\n"),
            save_failure: null,
            reset_count: current.current.reset_count + 1,
          });
      } catch (error) {
        if (!signal?.aborted && mounted.current) report(error, "load_failed");
      } finally {
        if (!signal?.aborted && mounted.current) update({ loading: false });
      }
    },
    [current, mounted, update, report],
  );
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);
  /** 恢复命令独占，失败时保留草稿与恢复入口。 */
  async function run(action: () => Promise<boolean>) {
    if (operation.current || locked) return false;
    cancel();
    update({ busy: true });
    const pending = action().catch((error: unknown) => {
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
  /** 先等待恢复命令，再判断最新草稿是否已保存。 */
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
    /** 放弃时换成最新正文，覆盖时以最新指纹重新保存草稿。 */
    recover: (overwrite: boolean) =>
      run(async () => {
        if (write.current) await write.current;
        const file = await api_fetch<KnowledgeFile>("/api/project/knowledge/read", {});
        update({
          file,
          save_failure: null,
          ...(!overwrite
            ? {
                draft: file.text.replace(/\r\n?/g, "\n"),
                reset_count: current.current.reset_count + 1,
              }
            : {}),
        });
        return overwrite ? flush() : true;
      }),
  };
}
