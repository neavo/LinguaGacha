import { AppButton } from "@frontend/widgets/app-button";
import type { AgentDocument } from "@shared/agent-workspace-file";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import type { AppViewerRange } from "@frontend/widgets/app-editor/app-editor-code-mirror";
import { api_fetch, api_blob } from "@frontend/app/desktop/desktop-api";
import { MediaViewport } from "@frontend/features/media-preview/media-viewport";
import { useI18n } from "@frontend/app/locale/locale-context";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { AgentFileContext } from "./agent-file-context";
import { useLayoutEffect, useRef, useEffect, useState, useContext, type JSX } from "react";
import { AgentMarkdown } from "./agent-markdown";
import { format_agent_json_preview } from "./agent-json-preview";
import type { OpenAgentPreview } from "./use-agent-previews";

type AgentPreviewContent = { activation: number } & (
  | { kind: "markdown"; text: string }
  | { kind: "image"; url: string; mime: string }
  | { kind: "code"; text: string; ranges: readonly AppViewerRange[] }
);

/** 按会话和打开意图读取文件，内容视图负责各自的阅读交互。 */
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
  const [content, set_content] = useState<AgentPreviewContent | null>(null);
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
        set_content({ kind: "image", url, mime: blob.type, activation: document.activation });
      } else {
        const result = await api_fetch<AgentDocument>(
          "/api/agent/workspace/document",
          { path: document.path, sessionId: session },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        // 读取和格式化共用失败入口，全部成功后再发布当前打开意图的内容。
        set_content({
          ...(document.preview === "json" || document.preview === "jsonl"
            ? {
                kind: "code" as const,
                ...format_agent_json_preview(result.content, document.preview),
              }
            : { kind: "markdown" as const, text: result.content }),
          activation: document.activation,
        });
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) {
        set_content(null);
        set_error(
          resolve_visible_error_message(
            error,
            text.current,
            text.current("agent_page.document.read_failed"),
          ),
        );
      }
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [document.path, document.preview, document.activation, session, retry]);
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
  if (content.kind === "image")
    return (
      <MediaViewport
        label={document.name}
        mode="image"
        image={{ url: content.url, mime: content.mime }}
      />
    );
  if (content.kind === "code")
    return (
      <div className="agent-code-document">
        <AppEditor
          variant="viewer"
          value={content.text}
          ranges={content.ranges}
          aria_label={document.name}
          active={active}
          initial_scroll_top={scroll[document.path] ?? 0}
          on_scroll={(top) => {
            scroll[document.path] = top;
          }}
        />
      </div>
    );
  return (
    <AgentMarkdownPreview
      document={document}
      active={active}
      scroll={scroll}
      text={content.text}
      activation={content.activation}
    />
  );
}

/** Markdown 独占锚点语义，已加载正文的版本决定何时可消费定位意图。 */
function AgentMarkdownPreview({
  document,
  active,
  scroll,
  text,
  activation,
}: {
  document: OpenAgentPreview;
  active: boolean;
  scroll: Record<string, number>;
  text: string;
  activation: number;
}): JSX.Element {
  const viewport = useRef<HTMLDivElement>(null);
  const applied_activation = useRef(-1); // 普通切回保持阅读位置，同一打开意图只定位一次。
  useLayoutEffect(() => {
    if (!active || !viewport.current || activation !== document.activation) return;
    viewport.current.scrollTop = scroll[document.path] ?? 0;
    if (document.anchor !== null && applied_activation.current !== document.activation) {
      applied_activation.current = document.activation;
      let anchor: string;
      try {
        anchor = decodeURIComponent(document.anchor);
      } catch {
        return; // 无法解码的标题片段没有可定位目标，正文仍可阅读。
      }
      const target = [...viewport.current.querySelectorAll<HTMLElement>("[id]")].find(
        (node) => node.id === anchor,
      );
      target?.scrollIntoView({ block: "start" });
    }
  }, [active, document.activation, document.anchor, document.path, scroll, activation, text]);
  return (
    <div
      ref={viewport}
      className="agent-document"
      onScroll={(event) => {
        if (active) scroll[document.path] = event.currentTarget.scrollTop;
      }}
    >
      <div className="agent-document__body">
        <AgentMarkdown text={text} streaming={false} document_path={document.path} />
      </div>
    </div>
  );
}
