import { AppButton } from "@frontend/widgets/app-button";
import { api_fetch, api_blob } from "@frontend/app/desktop/desktop-api";
import { MediaViewport } from "@frontend/features/media-preview/media-viewport";
import { useI18n } from "@frontend/app/locale/locale-context";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { AgentFileContext } from "./agent-file-context";
import { useLayoutEffect, useRef, useEffect, useState, useContext, type JSX } from "react";
import { AgentMarkdown } from "./agent-markdown";
import type { OpenAgentPreview } from "./use-agent-previews";

/** 每份文件独占读取与阅读视口，显式打开刷新内容并消费对应锚点。 */
export function AgentPreviewPage({
  document,
  active,
  scroll,
}: {
  document: OpenAgentPreview;
  active: boolean;
  scroll: Record<string, number>;
}): JSX.Element {
  const { t } = useI18n();
  const session = useContext(AgentFileContext)?.session_id;
  // 内容与读取意图一起发布，旧正文不能消费新锚点，图片 MIME 与 URL 保持同批次。
  const [content, set_content] = useState<{
    value: string;
    mime: string;
    activation: number;
  } | null>(null);
  const [error, set_error] = useState<string | null>(null);
  const [retry, set_retry] = useState(0);
  const text = useRef(t); // 在途请求的反馈使用当前界面语言。
  text.current = t;
  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    set_error(null);
    void (async () => {
      if (document.preview === "image") {
        const query = new URLSearchParams({ path: document.path, sessionId: session ?? "" });
        const blob = await api_blob(`/api/agent/workspace/image?${query}`, controller.signal);
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        set_content({ value: url, mime: blob.type, activation: document.activation });
      } else {
        const result = await api_fetch<{ content: string }>(
          "/api/agent/workspace/document",
          { path: document.path, sessionId: session },
          controller.signal,
        );
        if (!controller.signal.aborted)
          set_content({ value: result.content, mime: "", activation: document.activation });
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted)
        set_error(
          resolve_visible_error_message(
            error,
            text.current,
            text.current("agent_page.document.read_failed"),
          ),
        );
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [document.path, document.preview, document.activation, session, retry]);
  const viewport = useRef<HTMLDivElement>(null);
  const applied_activation = useRef(-1); // 普通切回保留阅读位置，同一锚点只定位一次。
  useLayoutEffect(() => {
    if (!active || !viewport.current || content?.activation !== document.activation) return;
    viewport.current.scrollTop = scroll[document.path] ?? 0;
    if (document.anchor !== null && applied_activation.current !== document.activation) {
      applied_activation.current = document.activation;
      let anchor: string;
      try {
        anchor = decodeURIComponent(document.anchor);
      } catch {
        return;
      }
      const target = [...viewport.current.querySelectorAll<HTMLElement>("[id]")].find(
        (node) => node.id === anchor,
      );
      target?.scrollIntoView({ block: "start" });
    }
  }, [active, document.activation, document.anchor, document.path, scroll, content]);
  if (error)
    return (
      <div className="agent-document">
        <p>{error}</p>
        <AppButton onClick={() => set_retry((value) => value + 1)}>
          {t("app.action.retry")}
        </AppButton>
      </div>
    );
  if (content === null)
    return (
      <div className="agent-document" aria-busy="true">
        {document.name}
      </div>
    );
  if (document.preview === "image")
    return (
      <MediaViewport
        label={document.name}
        mode="image"
        image={{ url: content.value, mime: content.mime }}
      />
    );
  return (
    <div
      ref={viewport}
      className="agent-document"
      onScroll={(event) => {
        if (active) scroll[document.path] = event.currentTarget.scrollTop;
      }}
    >
      <div className="agent-document__body">
        <AgentMarkdown text={content.value} streaming={false} document_path={document.path} />
      </div>
    </div>
  );
}
