import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import type { KnowledgeEntry, KnowledgeFile } from "@shared/project-knowledge";
import { api_fetch, DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";
import { usePageLeave } from "@frontend/app/navigation/page-leave-context";
import {
  useProjectChangeSignal,
  useDesktopState,
  useRuntimeSnapshot,
} from "@frontend/app/state/use-desktop-state";
import { useProjectChangeSeqForSections } from "@frontend/app/state/project-change-signal";
import { Card } from "@frontend/shadcn/card";
import { AppButton } from "@frontend/widgets/app-button";
import { AppContentState } from "@frontend/widgets/app-content-state";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { DocumentEditorToolbar } from "./document-editor-toolbar";
import { type DocumentListGroupHelp, DocumentListGroup, DocumentListRow } from "./document-list";
import type { ProjectWriteResult } from "@shared/project-event";
import { useAutosaveDocument } from "./use-autosave-document";

/** 工程知识随工程保存，新建交给 AGENT，页面只负责浏览、编辑和删除。 */
export function ProjectKnowledgeGroup({
  active,
  help,
  on_open,
}: {
  active: boolean;
  help: DocumentListGroupHelp;
  on_open: (path: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const seq = useProjectChangeSeqForSections(useProjectChangeSignal(), ["knowledge"]);
  const [entries, set_entries] = useState<KnowledgeEntry[]>([]);
  const [status, set_status] = useState<"loading" | "ready" | "error">("loading");
  const [reload, set_reload] = useState(0);
  useEffect(() => {
    if (!active) return; // 编辑器保存只使列表失效，返回列表时再读取。
    const controller = new AbortController();
    void api_fetch<KnowledgeEntry[]>("/api/project/knowledge/list", {}, controller.signal).then(
      (documents) => {
        if (!controller.signal.aborted) {
          set_entries(documents.toSorted((a, b) => a.path.localeCompare(b.path)));
          set_status("ready");
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          set_status((previous) => (previous === "ready" ? "ready" : "error")); // 重新读取失败时保留上次成功的列表。
          push_error_toast(t("app.feedback.load_failed"), error);
        }
      },
    );
    return () => controller.abort();
  }, [seq, active, reload, t]);
  return (
    <DocumentListGroup
      title={t("knowledge_page.knowledge")}
      busy={status === "loading"}
      help={help}
      empty={
        status === "ready" && entries.length === 0 ? t("knowledge_page.empty.knowledge") : undefined
      }
    >
      {status === "ready" && entries.length > 0 && (
        <Card render={<ul />} className="document-list__rows">
          {entries.map((entry) => (
            <DocumentListRow
              key={entry.path}
              name={entry.path}
              description={entry.description}
              open_disabled={false}
              on_open={() => on_open(entry.path)}
            />
          ))}
        </Card>
      )}
      {status === "error" && (
        <AppContentState status="error" on_retry={() => set_reload((value) => value + 1)} />
      )}
    </DocumentListGroup>
  );
}

/** 单篇工程知识的编辑器，自动保存接入离页流程。 */
export function ProjectKnowledgeEditor({
  path,
  on_back,
}: {
  path: string;
  on_back: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const editor = useProjectKnowledgeEditor(path);
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
        path={path.split("/")}
        busy={editor.busy || leaving}
        locked={locked || !editor.file}
        action="delete"
        confirm_description={t("knowledge_page.editor.delete_file_confirm")}
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
        on_action={async () => {
          const ok = await editor.delete_document();
          if (ok) on_back();
          return ok;
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
            aria_label={path}
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
function useProjectKnowledgeEditor(path: string) {
  const { commit_project_write } = useDesktopState();
  const locked = useRuntimeSnapshot().owner !== null;
  const operation = useRef<Promise<boolean> | null>(null); // 离页等待恢复或删除命令。
  const deleting = useRef(false); // 删除接管草稿后，保存循环只完成当前请求。
  const autosave = useAutosaveDocument<KnowledgeFile>({
    locked,
    read_text: (file) => file.text.replace(/\r\n?/g, "\n"),
    paused: () => deleting.current,
    save: async (file, draft) => {
      const result = await commit_project_write({
        operation: "knowledge.save",
        run: () =>
          api_fetch<ProjectWriteResult & { document: KnowledgeFile }>(
            "/api/project/knowledge/save",
            { path: file.path, fp: file.fp, text: draft },
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
        const file = await api_fetch<KnowledgeFile>(
          "/api/project/knowledge/read",
          { path },
          signal,
        );
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
    [path, current, mounted, update, report],
  );
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);
  /** 恢复和删除共享互斥，失败时保留草稿与恢复入口。 */
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
  /** 先等待文件命令，再判断最新草稿是否已保存。 */
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
    /** 覆盖仍使用最新指纹，目标已删除时由显式覆盖重建文档。 */
    recover: (overwrite: boolean) =>
      run(async () => {
        if (write.current) await write.current;
        let file: KnowledgeFile;
        try {
          file = await api_fetch<KnowledgeFile>("/api/project/knowledge/read", { path });
        } catch (error) {
          if (!(error instanceof DesktopApiError) || error.code !== "file.not_found") throw error;
          if (!overwrite) {
            update({ file: null, draft: "", save_failure: null });
            return true;
          }
          const result = await commit_project_write({
            operation: "knowledge.save",
            run: () =>
              api_fetch<ProjectWriteResult & { document: KnowledgeFile }>(
                "/api/project/knowledge/save",
                { path, text: current.current.draft },
              ),
          });
          file = result.payload.document;
        }
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
    /** 删除成功清除基线，阻止延迟保存重新创建文档。 */
    delete_document: () =>
      run(async () => {
        deleting.current = true;
        try {
          if (write.current) await write.current;
          const file = current.current.file;
          if (!file) return false;
          await commit_project_write({
            operation: "knowledge.delete",
            run: () =>
              api_fetch<ProjectWriteResult>("/api/project/knowledge/delete", {
                path: file.path,
                fp: file.fp,
              }),
          });
          update({ file: null, draft: "", save_failure: null });
          return true;
        } finally {
          deleting.current = false;
        }
      }),
  };
}
