import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import type {
  ProofreadingDialogContextState,
  ProofreadingDialogState,
} from "@frontend/pages/proofreading-page/proofreading-page-ui-types";
import { Badge } from "@frontend/shadcn/badge";
import { AppButton } from "@frontend/widgets/app-button";
import { read_optional_item_name_text } from "@shared/item-name";

type ProofreadingContextViewProps = {
  state: ProofreadingDialogContextState;
  target_row_id: string;
  file_path: string;
  draft_item: ProofreadingDialogState["draft_item"];
  on_retry: () => void;
};

/** 保留原字符以支持复制，同时为三类空白叠加可见标记。 */
function render_visible_whitespace(text: string): ReactNode[] {
  return text.split(/([ \t\u3000])/u).map((segment, index) => {
    let kind: "space" | "tab" | "fullwidth-space";
    if (segment !== " " && segment !== "\t" && segment !== "　") {
      return segment;
    }
    if (segment === " ") {
      kind = "space";
    } else if (segment === "\t") {
      kind = "tab";
    } else {
      kind = "fullwidth-space";
    }
    return (
      <span
        key={index}
        className={`proofreading-page__context-whitespace proofreading-page__context-whitespace--${kind}`}
      >
        {segment}
      </span>
    );
  });
}

/** 把可选姓名与正文组合为上下文双栏共用的字段内容。 */
function render_context_text(name: string | null, text: string): JSX.Element {
  return (
    <dd className="proofreading-page__context-text">
      {name === null ? null : (
        <Badge variant="secondary" title={name} className="proofreading-page__context-name">
          <span className="proofreading-page__context-name-label">{name}</span>
        </Badge>
      )}
      <span>{render_visible_whitespace(text)}</span>
    </dd>
  );
}

/** 固定展示当前条目同文件的原译文上下文，不承担编辑和列表操作。 */
export function ProofreadingContextView(props: ProofreadingContextViewProps): JSX.Element | null {
  const { t } = useI18n();

  if (props.state.status === "idle") {
    return null;
  }

  if (props.state.status === "loading") {
    return (
      <div className="proofreading-page__context-state" role="status">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        <span>{t("proofreading_page.context.loading")}</span>
      </div>
    );
  }

  if (props.state.status === "error") {
    return (
      <div className="proofreading-page__context-state" role="alert">
        <span>{t("proofreading_page.context.load_failed")}</span>
        <AppButton type="button" variant="outline" size="sm" onClick={props.on_retry}>
          {t("proofreading_page.action.retry")}
        </AppButton>
      </div>
    );
  }

  return (
    <section
      className="proofreading-page__context-view"
      aria-label={t("proofreading_page.context.title")}
    >
      <header className="proofreading-page__context-header">
        <span className="proofreading-page__context-file-path" title={props.file_path}>
          {props.file_path}
        </span>
      </header>

      <ol className="proofreading-page__context-items">
        {props.state.items.map((item) => {
          const is_current = item.row_id === props.target_row_id;
          const source_name = read_optional_item_name_text(item.name_src);
          const translation_name = is_current
            ? props.draft_item.name_dst || null
            : read_optional_item_name_text(item.name_dst);
          const translation = is_current ? props.draft_item.dst : item.dst;
          return (
            <li
              key={item.row_id}
              className="proofreading-page__context-item"
              aria-current={is_current ? "true" : undefined}
            >
              <div className="proofreading-page__context-item-meta">
                <span className="proofreading-page__context-row-number">#{item.row_number}</span>
              </div>
              <dl className="proofreading-page__context-pair">
                <div className="proofreading-page__context-field">
                  <dt>{t("proofreading_page.fields.source")}</dt>
                  {render_context_text(source_name, item.src)}
                </div>
                <div className="proofreading-page__context-field proofreading-page__context-field--translation">
                  <dt>{t("proofreading_page.fields.translation")}</dt>
                  {render_context_text(translation_name, translation)}
                </div>
              </dl>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
