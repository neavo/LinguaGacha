import { PencilLine } from "lucide-react";
import { type JSX, type ReactNode, useLayoutEffect, useRef } from "react";

import { useI18n } from "@frontend/app/locale/locale-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import type { ProofreadingDialogState } from "@frontend/pages/proofreading-page/proofreading-page-ui-types";
import type { ProofreadingContextItem } from "@shared/proofreading/proofreading-types";
import { Badge } from "@frontend/shadcn/badge";
import { AppButton } from "@frontend/widgets/app-button";
import { read_optional_item_name_text } from "@shared/item-name";

type ProofreadingContextViewProps = {
  items: ProofreadingContextItem[];
  target_row_id: string;
  draft_item: ProofreadingDialogState["draft_item"];
  disabled: boolean;
  on_open_item: (row_id: string) => Promise<void>;
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
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge className="proofreading-page__context-name">
                <span className="proofreading-page__context-name-label">{name}</span>
              </Badge>
            }
          />
          <TooltipContent>{name}</TooltipContent>
        </Tooltip>
      )}
      <span>{render_visible_whitespace(text)}</span>
    </dd>
  );
}

/** 展示同文件上下文，目标导航交给页面处理。 */
export function ProofreadingContextView(props: ProofreadingContextViewProps): JSX.Element {
  const { t } = useI18n();
  const edit_label = t("proofreading_page.action.edit_item");
  const items_ref = useRef<HTMLOListElement>(null); // 列表拥有滚动位置，进入时只定位一次。

  // 只在进入或目标变化时定位，浏览器限制滚动边界，后续阅读由用户控制。
  useLayoutEffect(() => {
    const list = items_ref.current;
    if (list === null) return;
    const current = list.querySelector<HTMLElement>("[aria-current='true']");
    if (current === null) return;
    list.scrollTop = current.offsetTop + current.offsetHeight / 2 - list.clientHeight / 2;
  }, [props.target_row_id]);

  return (
    <section
      className="proofreading-page__context-view"
      aria-label={t("proofreading_page.action.view_context")}
    >
      <ol ref={items_ref} className="proofreading-page__context-items">
        {props.items.map((item) => {
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
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <AppButton
                        variant="ghost"
                        size="icon-xs"
                        disabled={props.disabled}
                        aria-label={edit_label}
                        onClick={() => {
                          void props.on_open_item(item.row_id);
                        }}
                      >
                        <PencilLine aria-hidden="true" />
                      </AppButton>
                    }
                  />
                  <TooltipContent>{edit_label}</TooltipContent>
                </Tooltip>
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
