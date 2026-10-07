import type { JSX } from "react";
import type { LogDetail } from "@frontend/app/desktop/desktop-api";
import { useI18n } from "@frontend/app/locale/locale-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { Badge } from "@frontend/shadcn/badge";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { format_log_content_text, format_log_error_text } from "@shared/log";
import "@frontend/pages/log-window-page/log-detail-view.css";

/** 详情视图只接收已由 desktop-api 收窄的完整日志。 */
type LogDetailViewProps = {
  detail: LogDetail;
};

/** 按 LogContent 判别字段渲染普通文本、Agent JSON 或翻译对照。 */
export function LogDetailView(props: LogDetailViewProps): JSX.Element {
  const { t } = useI18n();
  const { content } = props.detail;

  // 普通文本与 Agent JSON 从诊断字段读取错误消息，翻译正文已包含用户错误。
  const error_text = format_log_error_text(
    props.detail.error,
    typeof content === "string" || content.kind === "agent",
  );
  const error_view =
    error_text === "" ? null : (
      <section className="log-detail-view__card log-detail-view__error">
        <h3>{t("log_window_page.detail.content.error")}</h3>
        <pre>{error_text}</pre>
      </section>
    );

  if (typeof content === "string" || content.kind === "agent" || content.kind === "text") {
    return (
      <div className="log-detail-view">
        <AppEditor
          variant="viewer"
          syntax={typeof content === "string" || content.kind === "text" ? "plain" : "json"}
          class_name="log-detail-view__card log-detail-view__card--editor"
          value={format_log_content_text(content)}
          aria_label={t("log_window_page.detail.title")}
        />
        {error_view}
      </div>
    );
  }

  return (
    <div className="log-detail-view">
      <div className="log-detail-view__card log-detail-view__summary">
        {content.summary.map((text, index) => (
          <p key={`${index.toString()}:${text}`}>{text}</p>
        ))}
      </div>

      {error_view}

      <section className="log-detail-view__card log-detail-view__result">
        <ol className="log-detail-view__items">
          {content.pairs.map((pair, index) => (
            <li key={index} className="log-detail-view__item">
              <span className="log-detail-view__item-index">#{String(index + 1)}</span>
              <dl className="log-detail-view__translation-pair">
                <div className="log-detail-view__field">
                  <dt>{t("log_window_page.detail.content.source_text")}</dt>
                  <dd className="log-detail-view__text">
                    {typeof pair.actor_src === "string" && pair.actor_src !== "" ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Badge className="log-detail-view__name-badge">
                              <span className="log-detail-view__name-badge-label">
                                {pair.actor_src}
                              </span>
                            </Badge>
                          }
                        />
                        <TooltipContent>{pair.actor_src}</TooltipContent>
                      </Tooltip>
                    ) : null}
                    <span>{pair.src}</span>
                  </dd>
                </div>
                <div className="log-detail-view__field log-detail-view__field--dst">
                  <dt>{t("log_window_page.detail.content.translated_text")}</dt>
                  <dd className="log-detail-view__text">
                    {typeof pair.actor_dst === "string" && pair.actor_dst !== "" ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Badge className="log-detail-view__name-badge">
                              <span className="log-detail-view__name-badge-label">
                                {pair.actor_dst}
                              </span>
                            </Badge>
                          }
                        />
                        <TooltipContent>{pair.actor_dst}</TooltipContent>
                      </Tooltip>
                    ) : null}
                    <span>{pair.dst}</span>
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      </section>

      {content.sections.map((section, index) => (
        <section
          key={`${index.toString()}:${section.title}`}
          className="log-detail-view__card log-detail-view__process"
        >
          <h3>{section.title}</h3>
          <pre>{section.text}</pre>
        </section>
      ))}
    </div>
  );
}
