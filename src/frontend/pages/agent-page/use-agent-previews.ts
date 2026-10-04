import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentFile } from "@shared/agent-workspace-file";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useProjectSessionUiState } from "@frontend/app/session/project-session-ui-state-context";

export type OpenAgentPreview = AgentFile & { anchor: string | null; activation: number };
type PreviewUiState = {
  chat_id: string;
  paths: string[];
  selected: string | null;
  scroll: Record<string, number>;
};
type PreviewState = { documents: OpenAgentPreview[]; selected: string | null };

/** 页面只拥有标签描述和阅读位置，正文与图片由内容面板读取。 */
export function useAgentPreviews(chat_id: string) {
  const { t } = useI18n();
  const text = useRef(t); // 请求在语言切换后完成时使用当前文案，文件读取不随语言重启。
  text.current = t;
  const { get_page_ui_state, set_page_ui_state } = useProjectSessionUiState();
  const [saved] = useState(() => get_page_ui_state<PreviewUiState>("agent-documents"));
  const restoring = useRef(true); // 恢复完成前保留原记录，避免空列表覆盖跨路由快照。
  const [state, set_state] = useState<PreviewState>({ documents: [], selected: null });
  const requests = useRef(new Map<string, AbortController>());
  const intent = useRef(0); // 只裁决选中项；较慢的有效读取仍可追加后台标签。
  const scroll = useRef<Record<string, number>>({});

  /** 文件入口已经完成读取，标签只发布描述、锚点和新的刷新意图。 */
  const open_file = useCallback((href: string, file: AgentFile): void => {
    const activation = ++intent.current;
    const anchor = href.includes("#") ? href.slice(href.indexOf("#") + 1) : null;
    requests.current.get(file.path)?.abort();
    set_state((previous) => {
      const next = { ...file, anchor, activation };
      return {
        documents: previous.documents.some((item) => item.path === file.path)
          ? previous.documents.map((item) => (item.path === file.path ? next : item))
          : [...previous.documents, next],
        selected: file.path,
      };
    });
  }, []);

  /** 切回对话只撤销自动切页意图，有效的后台读取仍可完成。 */
  const select = useCallback((path: string | null): void => {
    intent.current += 1;
    set_state((previous) => ({ ...previous, selected: path }));
  }, []);

  /** 关闭当前文档选择相邻页，并取消该路径尚未完成的读取。 */
  const close = useCallback((path: string): void => {
    intent.current += 1;
    requests.current.get(path)?.abort();
    delete scroll.current[path];
    set_state((previous) => {
      const index = previous.documents.findIndex((document) => document.path === path);
      const documents = previous.documents.filter((document) => document.path !== path);
      return {
        documents,
        selected:
          previous.selected === path
            ? (documents[Math.min(index, documents.length - 1)]?.path ?? null)
            : previous.selected,
      };
    });
  }, []);

  useEffect(() => {
    let active = true; // StrictMode 重连或离页后，旧恢复批次不能写回新实例。
    const restore_intent = intent.current;
    if (chat_id && saved?.chat_id === chat_id) {
      scroll.current = saved.scroll;
      // 恢复期间手动打开或关闭文件会取消对应读取，迟到描述不能重新打开旧标签。
      const restoring_requests = saved.paths.map((path) => {
        const controller = new AbortController();
        requests.current.set(path, controller);
        return api_fetch<AgentFile>(
          "/api/agent/workspace/file",
          { path, chatId: chat_id },
          controller.signal,
        )
          .then((file) => (controller.signal.aborted ? null : file))
          .catch((error: unknown) => {
            if (!controller.signal.aborted) {
              const t = text.current;
              push_toast(
                "error",
                resolve_visible_error_message(error, t, t("agent_page.document.read_failed")),
              );
            }
            return null;
          });
      });
      void Promise.all(restoring_requests).then((results) => {
        if (!active) return;
        restoring.current = false;
        set_state((previous) => {
          const restored = results
            .filter(
              (item, index): item is AgentFile =>
                item !== null &&
                item.preview !== null &&
                !requests.current.get(saved.paths[index]!)?.signal.aborted,
            )
            .filter((item) => !previous.documents.some((current) => current.path === item.path))
            .map((item) => ({ ...item, anchor: null, activation: 0 }));
          const documents = [...restored, ...previous.documents];
          return {
            documents,
            selected:
              intent.current === restore_intent &&
              documents.some((item) => item.path === saved.selected)
                ? saved.selected
                : previous.selected,
          };
        });
      });
    } else restoring.current = false;
    const pending = requests.current;
    return () => {
      active = false;
      for (const controller of pending.values()) controller.abort();
      pending.clear();
    };
  }, [saved, chat_id]);

  // 各预览更新同一份阅读位置记录，保存无需逐次触发 React 渲染。
  useEffect(() => {
    if (!chat_id || restoring.current) return;
    set_page_ui_state<PreviewUiState>("agent-documents", {
      chat_id,
      paths: state.documents.map((document) => document.path),
      selected: state.selected,
      scroll: scroll.current,
    });
  }, [state, chat_id, set_page_ui_state]);

  return { ...state, select, close, open_file, scroll };
}
