import { DocumentEditorToolbar } from "./document-editor-toolbar";
import { useAutosaveDocument } from "./use-autosave-document";
import { AGENT_SKILL_MAIN_FILE, type AgentSkillFileEntry } from "@shared/agent-skills";
import { SkillEditorWorkspace } from "./skill-editor";
import { personality_editor_extension } from "./skill-editor-extension";
import { type JSX, useCallback, useEffect, useRef } from "react";
import type { AgentPersonality } from "@shared/agent-personality";
import { useI18n } from "@frontend/app/locale/locale-context";
import { usePageLeave } from "@frontend/app/navigation/page-leave-context";
import { useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { AppContentState } from "@frontend/widgets/app-content-state";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { Card } from "@frontend/shadcn/card";
import { format_skill_editor_document, read_skill_editor_document } from "./skill-editor-document";
import "./skill-editor.css";

const PERSONALITY_FILES: AgentSkillFileEntry[] = [{ path: AGENT_SKILL_MAIN_FILE, kind: "file" }]; // 固定导航映射到配置正文。

/** 人格呈现固定技能文档，文件结构与元数据由界面拥有，保存载荷只有正文。 */
export function PersonalityEditor({ on_back }: { on_back: () => void }): JSX.Element {
  const { t } = useI18n();
  const editor = usePersonalityEditor();
  const { leaving, register_before_leave } = usePageLeave();
  useEffect(() => register_before_leave(editor.flush), [editor.flush, register_before_leave]);
  const locked = editor.locked || editor.busy || leaving;
  return (
    <section
      className="document-editor"
      aria-busy={!editor.saved && editor.busy}
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
        confirm_description={t("knowledge_page.editor.reset_skill_confirm")}
        path={["personality", AGENT_SKILL_MAIN_FILE]}
        busy={editor.busy || leaving}
        locked={locked || !editor.saved}
        action="reset"
        on_action={editor.reset}
        status={
          !editor.saved
            ? null
            : editor.save_failed
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
      />

      {editor.saved && (
        <SkillEditorWorkspace
          entries={PERSONALITY_FILES}
          path={AGENT_SKILL_MAIN_FILE}
          readonly
          busy={editor.busy || leaving}
          on_open={editor.flush}
        >
          <Card className="document-editor__content" data-readonly={locked || undefined}>
            <AppEditor
              key={editor.reset_count}
              class_name="document-editor__text"
              aria_label={AGENT_SKILL_MAIN_FILE}
              syntax="markdown"
              read_only={locked}
              indent_with_tab
              extensions={personality_editor_extension}
              value={format_skill_editor_document({
                name: "personality",
                description: t("knowledge_page.personality_description"),
                body: editor.draft,
              })}
              on_change={(value) => editor.edit(read_skill_editor_document(value).body)}
            />
          </Card>
        </SkillEditorWorkspace>
      )}
      {!editor.saved && !editor.busy && <AppContentState status="error" />}
    </section>
  );
}

/** 重置等待在途保存再接管草稿，自动保存与技能、知识共用同一循环。 */
function usePersonalityEditor() {
  const locked = useRuntimeSnapshot().owner === "agent";
  const environment = useRef({ locked });
  environment.current = { locked };
  const reading = useRef<AbortController | null>(null);
  const resetting = useRef<Promise<boolean> | null>(null); // 重置接管草稿，离页等待同一请求。
  const autosave = useAutosaveDocument<AgentPersonality>({
    initial: { busy: true },
    locked,
    read_text: (file) => file.body,
    equal: (left, right) => left.trim() === right.trim(),
    paused: () => resetting.current !== null,
    save: (file, draft) =>
      api_fetch<AgentPersonality>("/api/agent/personality/save", {
        body: draft,
        revision: file.revision,
      }),
  });
  const { state, current, update, cancel, report, write, flush: save } = autosave;
  /** 卸载或重新挂载时取消旧读取。 */
  const reload = useCallback(async () => {
    cancel();
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    update({ busy: true, save_failure: null });
    try {
      const file = await api_fetch<AgentPersonality>(
        "/api/agent/personality/read",
        {},
        controller.signal,
      );
      if (!controller.signal.aborted)
        update({ file, draft: file.body, reset_count: current.current.reset_count + 1 });
    } catch (error) {
      if (!controller.signal.aborted) report(error, "load_failed");
    } finally {
      if (!controller.signal.aborted) update({ busy: false, loading: false });
    }
  }, [cancel, current, report, update]);
  useEffect(() => {
    void reload();
    return () => {
      reading.current?.abort();
    };
  }, [reload]);
  /** 等待在途保存，再用最新版本清除用户覆盖。 */
  const reset = async (): Promise<boolean> => {
    if (environment.current.locked || resetting.current) return false;
    cancel();
    update({ busy: true });
    /** 重置失败保留正文，避免把未保存的草稿误报为默认值。 */
    const run = async () => {
      try {
        if (write.current) await write.current;
        const latest = await api_fetch<AgentPersonality>("/api/agent/personality/read", {});
        const file = await api_fetch<AgentPersonality>("/api/agent/personality/save", {
          body: null,
          revision: latest.revision,
        });
        update({
          file,
          draft: file.body,
          save_failure: null,
          reset_count: current.current.reset_count + 1,
        });
        return true;
      } catch (error) {
        report(error);
        return false;
      } finally {
        update({ busy: false });
      }
    };
    const pending = run();
    resetting.current = pending;
    try {
      return await pending;
    } finally {
      resetting.current = null;
    }
  };
  /** 离页先等待重置，再检查普通保存。 */
  const flush = useCallback(async () => {
    if (resetting.current && !(await resetting.current)) return false;
    return save();
  }, [save]);
  return {
    ...state,
    saved: state.file,
    save_failed: state.save_failure !== null,
    dirty: autosave.dirty,
    locked,
    reset,
    flush,
    edit: autosave.edit,
    compose: autosave.compose,
  };
}
