import { useEffect, useRef, useState } from "react";
import { useAppearance } from "@frontend/app/appearance/appearance-provider";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { AgentMediaPreviewDialog } from "./agent-media-preview-dialog";
import {
  mermaid_renderer,
  normalize_mermaid_source,
  type MermaidRenderResult,
} from "./agent-mermaid-renderer";

type MermaidViewState =
  | { key: string; source_key: string; status: "pending"; svg?: string }
  | { key: string; source_key: string; status: "success"; svg: string }
  | { key: string; source_key: string; status: "error" };

/** Mermaid 常驻时间线，预览弹窗只提供更大的阅读画布。 */
export function AgentMermaidBlock({ source }: { source: string }): JSX.Element {
  const { t } = useI18n();
  const { resolved_theme } = useAppearance();
  const preview_trigger_ref = useRef<HTMLButtonElement>(null);
  const normalized_source = normalize_mermaid_source(source);
  const source_key = normalized_source;
  const render_key = `${resolved_theme}\u0000${source_key}`;
  const [render_state, set_render_state] = useState<MermaidViewState>({
    key: render_key,
    source_key,
    status: "pending",
  });
  const [preview_open, set_preview_open] = useState(false);

  // 主题切换时暂留同源码旧图，源码切换则立即移除不再匹配的结果。
  useEffect(() => {
    let active = true;
    set_render_state((previous_state) => {
      if (previous_state.key === render_key) return previous_state;
      const retained_svg =
        previous_state.source_key === source_key && "svg" in previous_state
          ? previous_state.svg
          : undefined;
      return { key: render_key, source_key, status: "pending", svg: retained_svg };
    });

    void mermaid_renderer.request(normalized_source, resolved_theme).then((result) => {
      if (!active) return;
      set_render_state(to_view_state(render_key, source_key, result));
    });
    return () => {
      active = false;
    };
  }, [normalized_source, render_key, resolved_theme, source_key]);

  /** 关闭弹窗后把键盘焦点交还给原图表入口。 */
  const close_preview = (): void => {
    set_preview_open(false);
    window.requestAnimationFrame(() => preview_trigger_ref.current?.focus());
  };
  const svg = "svg" in render_state ? render_state.svg : undefined;
  const has_svg = svg !== undefined;

  return (
    <>
      <figure
        className="agent-markdown__diagram"
        aria-busy={render_state.status === "pending"}
        data-status={render_state.status}
      >
        {has_svg ? (
          <button
            ref={preview_trigger_ref}
            type="button"
            className="agent-markdown__diagram-trigger"
            aria-haspopup="dialog"
            aria-label={t("agent_page.diagram.open_preview")}
            title={t("agent_page.diagram.open_preview")}
            onClick={() => set_preview_open(true)}
          >
            <span dangerouslySetInnerHTML={{ __html: svg }} />
          </button>
        ) : (
          <div className="agent-markdown__diagram-content">
            {render_state.status === "pending" ? (
              <p className="agent-markdown__diagram-pending" role="status">
                {t("agent_page.diagram.rendering")}
              </p>
            ) : null}
            {render_state.status === "error" ? (
              <div className="agent-markdown__diagram-error">
                <p>{t("agent_page.diagram.render_failed")}</p>
                <MermaidSource source={normalized_source} />
              </div>
            ) : null}
          </div>
        )}
      </figure>
      <AgentMermaidPreviewDialog
        open={preview_open}
        on_close={close_preview}
        source={normalized_source}
        render_state={render_state}
      />
    </>
  );
}

/** 预览只消费同一视图状态，不触发第二次 Mermaid 渲染。 */
function AgentMermaidPreviewDialog(props: {
  open: boolean;
  on_close: () => void;
  source: string;
  render_state: MermaidViewState;
}): JSX.Element {
  const { t } = useI18n();
  const svg = "svg" in props.render_state ? props.render_state.svg : undefined;
  const has_svg = svg !== undefined;
  return (
    <AgentMediaPreviewDialog
      key={props.render_state.key}
      open={props.open}
      title={t("agent_page.diagram.preview_title")}
      onClose={props.on_close}
    >
      {has_svg ? (
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      ) : props.render_state.status === "pending" ? (
        <p role="status">{t("agent_page.diagram.rendering")}</p>
      ) : (
        <div className="agent-markdown__diagram-error">
          <p>{t("agent_page.diagram.render_failed")}</p>
          <MermaidSource source={props.source} />
        </div>
      )}
    </AgentMediaPreviewDialog>
  );
}

/** 把渲染器结果收窄为组件所需的最小视图状态。 */
function to_view_state(
  key: string,
  source_key: string,
  result: MermaidRenderResult,
): MermaidViewState {
  return result.status === "success"
    ? { key, source_key, status: "success", svg: result.svg }
    : { key, source_key, status: "error" };
}

/** Mermaid 失败时保留原始源码，便于复制和诊断。 */
function MermaidSource({ source }: { source: string }): JSX.Element {
  return (
    <pre>
      <code className="language-mermaid">{source}</code>
    </pre>
  );
}
