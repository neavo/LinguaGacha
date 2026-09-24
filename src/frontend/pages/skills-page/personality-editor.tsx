import { AGENT_SKILL_MAIN_FILE, type AgentSkillFileEntry } from "@shared/agent-skills";
import { SkillEditorToolbar, SkillEditorWorkspace } from "./skill-editor";
import { personality_editor_extension } from "./skill-editor-extension";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentPersonality } from "@shared/agent-personality";
import { useI18n } from "@frontend/app/locale/locale-context";
import { usePageLeave } from "@frontend/app/navigation/page-leave-context";
import { useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { AppButton } from "@frontend/widgets/app-button";
import { AppContentState } from "@frontend/widgets/app-content-state";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { Card } from "@frontend/shadcn/card";
import {
  SKILL_AUTOSAVE_DELAY_MS,
  format_skill_editor_document,
  read_skill_editor_document,
} from "./skill-editor-document";
import "./skill-editor.css";

const PERSONALITY_FILES: AgentSkillFileEntry[] = [{ path: AGENT_SKILL_MAIN_FILE, kind: "file" }]; // 固定导航映射到配置正文。

/** 人格呈现固定技能文档，文件结构与元数据由界面拥有，保存载荷只有正文。 */
export function PersonalityEditor({ on_back }: { on_back: () => void }): JSX.Element {
  const { t } = useI18n();
  const editor = usePersonalityEditor();
  const { leaving, register_before_leave } = usePageLeave();
  useEffect(() => register_before_leave(editor.flush), [editor.flush, register_before_leave]);
  const locked = editor.locked || editor.busy || leaving;
  // 运行占用会暂停自动保存，隐藏反馈直到恢复，避免把暂停显示为持续保存。
  const status =
    !editor.saved || editor.locked
      ? null
      : editor.error
        ? "failed"
        : editor.dirty || editor.saving
          ? "saving"
          : "saved";
  return (
    <section
      className="skill-editor"
      onCompositionStart={() => editor.compose(true)}
      onCompositionEnd={() => editor.compose(false)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          if (!locked) void editor.flush();
        }
      }}
    >
      <SkillEditorToolbar
        path={["personality", AGENT_SKILL_MAIN_FILE]}
        busy={editor.busy || leaving}
        locked={locked || !editor.saved}
        action="reset"
        on_action={editor.reset}
        status={status}
        on_back={() => {
          void editor.flush().then((ok) => {
            if (ok) on_back();
          });
        }}
      />
      {!editor.saved ? (
        <Card className="skill-editor__state">
          <AppContentState
            status={editor.error ? "error" : "loading"}
            message={editor.error || t("app.action.loading")}
            on_retry={() => {
              void editor.reload();
            }}
          />
        </Card>
      ) : (
        <SkillEditorWorkspace
          entries={PERSONALITY_FILES}
          path={AGENT_SKILL_MAIN_FILE}
          readonly
          busy={editor.busy || leaving}
          on_open={editor.flush}
        >
          <Card className="skill-editor__content" data-readonly={locked || undefined}>
            {editor.error && (
              <div className="skill-editor__error" role="alert">
                {editor.error}
                <div>
                  <AppButton
                    size="sm"
                    variant="outline"
                    disabled={locked || editor.saving}
                    onClick={() => {
                      void editor.flush();
                    }}
                  >
                    {t("app.action.retry")}
                  </AppButton>
                  <AppButton
                    size="sm"
                    variant="ghost"
                    disabled={editor.busy || editor.saving}
                    onClick={() => {
                      void editor.reload();
                    }}
                  >
                    {t("skills_page.editor.discard")}
                  </AppButton>
                </div>
              </div>
            )}
            <AppEditor
              key={editor.reset_count}
              class_name="skill-editor__text"
              aria_label={AGENT_SKILL_MAIN_FILE}
              syntax="markdown"
              read_only={locked}
              indent_with_tab
              extensions={personality_editor_extension}
              value={format_skill_editor_document({
                name: "personality",
                description: t("skills_page.personality_description"),
                body: editor.draft,
              })}
              on_change={(value) => editor.edit(read_skill_editor_document(value).body)}
            />
          </Card>
        </SkillEditorWorkspace>
      )}
    </section>
  );
}

type PersonalityEditorState = {
  saved: AgentPersonality | null;
  draft: string;
  error: string;
  busy: boolean;
  saving: boolean;
  composing: boolean;
  reset_count: number;
};

/** 保存校验版本，重置等待在途保存后接管草稿，避免旧正文覆盖默认值。 */
function usePersonalityEditor() {
  const { t } = useI18n();
  const locked = useRuntimeSnapshot().owner === "agent";
  const environment = useRef({ locked, t }); // 异步回调读取当前占用与语言。
  environment.current = { locked, t };
  const [state, set_state] = useState<PersonalityEditorState>({
    saved: null,
    draft: "",
    error: "",
    busy: false,
    saving: false,
    composing: false,
    reset_count: 0,
  });
  const current = useRef(state); // 在途保存继续提交最新输入。
  const mounted = useRef(false); // 卸载后停止更新界面和继续保存。
  const reading = useRef<AbortController | null>(null); // 重载与卸载取消旧查询。
  const writing = useRef<Promise<boolean> | null>(null); // 自动保存与离页共用在途请求。
  const resetting = useRef<Promise<boolean> | null>(null); // 重置接管旧草稿，离页等待其完成。
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null); // 输入暂停后触发一次保存。
  /** 同步更新异步回调读取的状态与界面快照。 */
  const update = useCallback((patch: Partial<PersonalityEditorState>) => {
    current.current = { ...current.current, ...patch };
    if (mounted.current) set_state(current.current);
  }, []);
  /** 显式保存、重置和离页接管尚未触发的自动保存。 */
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  /** 将原始异常转换为当前语言的页面反馈。 */
  const report = useCallback(
    (error: unknown, context: "load_failed" | "save_failed" = "save_failed") => {
      const text = environment.current.t;
      update({
        error: resolve_visible_error_message(error, text, text(`skills_page.feedback.${context}`)),
      });
    },
    [update],
  );
  /** 加载当前正文并清除旧撤销历史，过期查询不能覆盖新草稿。 */
  const reload = useCallback(async () => {
    cancel();
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    update({ busy: true, error: "" });
    try {
      const saved = await api_fetch<AgentPersonality>(
        "/api/agent/personality/read",
        {},
        controller.signal,
      );
      if (!controller.signal.aborted)
        update({ saved, draft: saved.body, reset_count: current.current.reset_count + 1 });
    } catch (error) {
      if (!controller.signal.aborted) report(error, "load_failed");
    } finally {
      if (!controller.signal.aborted) update({ busy: false });
    }
  }, [cancel, report, update]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      reading.current?.abort();
      cancel();
    };
  }, [reload, cancel]);

  /** 串行保存到基线追上草稿，组词和重置期间暂停提交。 */
  const save = useCallback(async (): Promise<boolean> => {
    cancel();
    if (writing.current) return await writing.current;
    /** 一个保存请求结束后检查期间产生的新输入。 */
    const run = async (): Promise<boolean> => {
      update({ error: "" });
      try {
        while (mounted.current && !resetting.current) {
          const { saved, draft, composing } = current.current;
          if (!saved || draft === saved.body) return true;
          if (environment.current.locked || composing) return false;
          update({ saving: true });
          const next = await api_fetch<AgentPersonality>("/api/agent/personality/save", {
            body: draft,
            revision: saved.revision,
          });
          update({ saved: next });
        }
        return true;
      } catch (error) {
        report(error);
        return false;
      } finally {
        update({ saving: false });
      }
    };
    const pending = run();
    writing.current = pending;
    try {
      return await pending;
    } finally {
      writing.current = null;
    }
  }, [cancel, report, update]);
  const dirty = state.saved !== null && state.draft !== state.saved.body;
  useEffect(() => {
    if (dirty && !locked && !state.busy && !state.saving && !state.composing && !state.error)
      timer.current = setTimeout(() => {
        void save();
      }, SKILL_AUTOSAVE_DELAY_MS);
    return cancel;
  }, [dirty, locked, state, save, cancel]);

  /** 等待在途保存后清除用户覆盖，再替换编辑器基线。 */
  const reset = async (): Promise<boolean> => {
    if (environment.current.locked || resetting.current) return false;
    cancel();
    update({ busy: true });
    /** 读取最新版本后重置，保存失败的旧版本也能恢复默认值。 */
    const run = async (): Promise<boolean> => {
      try {
        if (writing.current) await writing.current;
        const latest = await api_fetch<AgentPersonality>("/api/agent/personality/read", {});
        const saved = await api_fetch<AgentPersonality>("/api/agent/personality/save", {
          body: null,
          revision: latest.revision,
        });
        update({
          saved,
          draft: saved.body,
          error: "",
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
  /** 离页先等待重置，再确认最新草稿已保存。 */
  const flush = useCallback(async () => {
    if (resetting.current && !(await resetting.current)) return false;
    return await save();
  }, [save]);
  return {
    ...state,
    dirty,
    locked,
    reload,
    reset,
    flush,
    /** 新输入解除错误暂停，交给自动保存继续提交。 */
    edit: (draft: string) => {
      if (!environment.current.locked && !current.current.busy) update({ draft, error: "" });
    },
    /** 组词开始时取消倒计时，结束后重新等待输入停顿。 */
    compose: (composing: boolean) => {
      if (composing) cancel();
      update({ composing });
    },
  };
}
