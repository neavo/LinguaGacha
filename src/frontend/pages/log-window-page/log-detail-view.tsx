import type { LogDetail } from "@frontend/app/desktop/desktop-api";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { Badge } from "@frontend/shadcn/badge";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { format_log_readable_text } from "@shared/log";
import "@frontend/pages/log-window-page/log-detail-view.css";

/** 详情视图只接收已由 desktop-api 收窄的完整日志。 */
type LogDetailViewProps = {
  detail: LogDetail;
};

/** 按 LogContent 判别字段渲染普通文本、翻译对照或分析术语详情。 */
export function LogDetailView(props: LogDetailViewProps): JSX.Element {
  const { t } = useI18n();
  const { content } = props.detail;

  if (content.kind === "text") {
    return (
      <AppEditor
        variant="viewer"
        class_name="log-window-page__detail-editor"
        value={format_log_readable_text(props.detail)}
        aria_label={t("log_window_page.detail.title")}
      />
    );
  }

  // 结构化结果已有独立内容布局，异常只追加诊断字段，避免再次生成正文投影。
  const error_text = props.detail.error?.stack?.trim() ?? "";

  return (
    <div className="log-detail-view">
      <div className="log-detail-view__summary" data-level={props.detail.level}>
        {content.summary.map((text, index) => (
          <p key={`${index.toString()}:${text}`}>{text}</p>
        ))}
      </div>

      {error_text === "" ? null : (
        <section className="log-detail-view__error">
          <h3>{t("log_window_page.detail.content.error")}</h3>
          <pre>{error_text}</pre>
        </section>
      )}

      <section className="log-detail-view__result">
        <ol className="log-detail-view__items">
          {content.pairs.map((pair, index) => (
            <li key={index} className="log-detail-view__item">
              <span className="log-detail-view__item-index">#{String(index + 1)}</span>
              <dl className="log-detail-view__translation-pair">
                <div className="log-detail-view__field">
                  <dt>{t("log_window_page.detail.content.source_text")}</dt>
                  <dd className="log-detail-view__text">
                    {typeof pair.actor_src === "string" && pair.actor_src !== "" ? (
                      <Badge
                        variant="secondary"
                        title={pair.actor_src}
                        className="log-detail-view__name-badge"
                      >
                        <span className="log-detail-view__name-badge-label">{pair.actor_src}</span>
                      </Badge>
                    ) : null}
                    <span>{pair.src}</span>
                  </dd>
                </div>
                <div className="log-detail-view__field log-detail-view__field--dst">
                  <dt>{t("log_window_page.detail.content.translated_text")}</dt>
                  <dd className="log-detail-view__text">
                    {typeof pair.actor_dst === "string" && pair.actor_dst !== "" ? (
                      <Badge
                        variant="secondary"
                        title={pair.actor_dst}
                        className="log-detail-view__name-badge"
                      >
                        <span className="log-detail-view__name-badge-label">{pair.actor_dst}</span>
                      </Badge>
                    ) : null}
                    <span>{pair.dst}</span>
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      </section>

      {content.sections.length > 0 ? (
        <div className="log-detail-view__process">
          {content.sections.map((section, index) => (
            <section key={`${index.toString()}:${section.title}`}>
              <h3>{section.title}</h3>
              <pre>{section.text}</pre>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
