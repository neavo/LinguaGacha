import { useLayoutEffect, useRef, type JSX } from "react";
import { AgentMarkdown } from "./agent-markdown";
import type { OpenAgentDocument } from "./use-agent-documents";

/** 每份文件独占阅读视口；重复激活仅消费新的锚点意图。 */
export function AgentDocumentPage({
  document,
  active,
  scroll,
}: {
  document: OpenAgentDocument;
  active: boolean;
  scroll: Record<string, number>;
}): JSX.Element {
  const viewport = useRef<HTMLDivElement>(null);
  const applied_activation = useRef(-1); // 普通切回保留阅读位置，同一锚点只定位一次。
  useLayoutEffect(() => {
    if (!active || !viewport.current) return;
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
  }, [active, document.activation, document.anchor, document.path, scroll]);
  return (
    <div
      ref={viewport}
      className="agent-document"
      onScroll={(event) => {
        if (active) scroll[document.path] = event.currentTarget.scrollTop;
      }}
    >
      <div className="agent-document__body">
        <AgentMarkdown text={document.content} streaming={false} document_path={document.path} />
      </div>
    </div>
  );
}
