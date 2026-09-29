import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentDocument } from "@shared/agent-workspace-file";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useProjectSessionUiState } from "@frontend/app/session/project-session-ui-state-context";

export type OpenAgentDocument = AgentDocument & { anchor: string | null; activation: number };
type DocumentUiState = {
  session_id: string;
  paths: string[];
  selected: string | null;
  scroll: Record<string, number>;
};
type DocumentState = { documents: OpenAgentDocument[]; selected: string | null };
type DocumentRequest = { controller: AbortController; promise: Promise<AgentDocument | null> };

/** 页面拥有正文；跨路由只保留路径和阅读位置。请求完成后才发布新标签。 */
export function useAgentDocuments(session_id: string) {
  const { t } = useI18n();
  const text = useRef(t); // 请求在语言切换后完成时使用当前文案，文件读取不随语言重启。
  text.current = t;
  const { get_page_ui_state, set_page_ui_state } = useProjectSessionUiState();
  const [saved] = useState(() => get_page_ui_state<DocumentUiState>("agent-documents"));
  const restoring = useRef(true); // 恢复完成前保留原记录，避免空列表覆盖跨路由快照。
  const [state, set_state] = useState<DocumentState>({ documents: [], selected: null });
  const requests = useRef(new Map<string, DocumentRequest>());
  const intent = useRef(0); // 只裁决选中项；较慢的有效读取仍可追加后台标签。
  const scroll = useRef<Record<string, number>>({});

  /** 同一路径共用请求、错误反馈和取消信号；关闭与离页由信号使结果失效。 */
  const read = useCallback(
    (path: string): DocumentRequest => {
      const pending = requests.current.get(path);
      if (pending) return pending;
      const controller = new AbortController();
      const request: DocumentRequest = {
        controller,
        promise: api_fetch<AgentDocument>(
          "/api/agent/workspace/document",
          { path, sessionId: session_id },
          controller.signal,
        )
          .then((document) =>
            controller.signal.aborted || document.sessionId !== session_id ? null : document,
          )
          .catch((error: unknown) => {
            if (!controller.signal.aborted) {
              const t = text.current;
              push_toast(
                "error",
                resolve_visible_error_message(error, t, t("agent_page.document.read_failed")),
              );
            }
            return null;
          })
          .finally(() => {
            if (requests.current.get(path) === request) requests.current.delete(path);
          }),
      };
      requests.current.set(path, request);
      return request;
    },
    [session_id],
  );

  /** 已打开文档立即可读；请求成功后原子发布正文与用户选中的标签。 */
  const open_document = useCallback(
    async (href: string): Promise<void> => {
      const request_intent = ++intent.current;
      const path = href.split(/[?#]/u, 1)[0]!;
      const anchor = href.includes("#") ? href.slice(href.indexOf("#") + 1) : null;
      set_state((previous) =>
        previous.documents.some((document) => document.path === path)
          ? { ...previous, selected: path }
          : previous,
      );
      const request = read(path);
      const document = await request.promise;
      if (!document || request.controller.signal.aborted) return;
      set_state((previous) => {
        const next = { ...document, anchor, activation: request_intent };
        const exists = previous.documents.some((item) => item.path === document.path);
        return {
          documents: exists
            ? previous.documents.map((item) => (item.path === document.path ? next : item))
            : [...previous.documents, next],
          selected: request_intent === intent.current ? document.path : previous.selected,
        };
      });
    },
    [read],
  );

  /** 切回对话只撤销自动切页意图，有效的后台读取仍可完成。 */
  const select = useCallback(
    (path: string | null): void => {
      if (path !== null) {
        void open_document(path);
        return;
      }
      intent.current += 1;
      set_state((previous) => ({ ...previous, selected: null }));
    },
    [open_document],
  );

  /** 关闭当前文档选择相邻页，并取消该路径尚未完成的读取。 */
  const close = useCallback((path: string): void => {
    intent.current += 1;
    requests.current.get(path)?.controller.abort();
    requests.current.delete(path);
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
    if (session_id && saved?.session_id === session_id) {
      scroll.current = saved.scroll;
      const restoring_requests = saved.paths.map(read);
      void Promise.all(restoring_requests.map((request) => request.promise)).then((results) => {
        if (!active) return;
        restoring.current = false;
        set_state((previous) => {
          const restored = results
            .filter(
              (item, index): item is AgentDocument =>
                item !== null && !restoring_requests[index]!.controller.signal.aborted,
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
      for (const request of pending.values()) request.controller.abort();
      pending.clear();
    };
  }, [saved, read, session_id]);

  // 正文只驻页面；各文档更新同一份阅读位置记录，保存无需逐次触发 React 渲染。
  useEffect(() => {
    if (!session_id || restoring.current) return;
    set_page_ui_state<DocumentUiState>("agent-documents", {
      session_id,
      paths: state.documents.map((document) => document.path),
      selected: state.selected,
      scroll: scroll.current,
    });
  }, [state, session_id, set_page_ui_state]);

  return { ...state, select, close, open_document, scroll };
}
