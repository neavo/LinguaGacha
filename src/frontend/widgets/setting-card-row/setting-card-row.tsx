import type { JSX, ReactNode } from "react";

import { render_rich_text, type RichTextComponentMap } from "@frontend/app/locale/rich-text";
import { cn } from "@frontend/shadcn/classnames";
import { Card, CardContent } from "@frontend/shadcn/card";
import "@frontend/widgets/setting-card-row/setting-card-row.css";

type SettingCardRowProps = {
  title: string;
  description: ReactNode;
  action: ReactNode;
  action_width?: "fixed" | "content";
  className?: string;
  title_suffix?: ReactNode;
  embedded?: boolean; // 组合进外层面板时不再自带卡片外框，间距由外层面板负责
};

const DESCRIPTION_COMPONENT_MAP: RichTextComponentMap = {
  emphasis: (children) => {
    return <span className="setting-card-row__description-emphasis font-medium">{children}</span>;
  },
};

export function SettingCardRow(props: SettingCardRowProps): JSX.Element {
  const description_content =
    typeof props.description === "string"
      ? render_rich_text(props.description, DESCRIPTION_COMPONENT_MAP)
      : props.description;

  const content = (
    <>
      <div className="setting-card-row__copy">
        <div className="setting-card-row__heading">
          <h2 className="setting-card-row__title font-medium">{props.title}</h2>
          {props.title_suffix !== undefined ? (
            <div className="setting-card-row__title-suffix">{props.title_suffix}</div>
          ) : null}
        </div>
        <p className="setting-card-row__description">{description_content}</p>
      </div>

      <div className="setting-card-row__action">{props.action}</div>
    </>
  );

  if (props.embedded === true) {
    return (
      <div
        className={cn(
          "setting-card-row__content",
          "setting-card-row--embedded",
          props.action_width === "content" && "setting-card-row--content-action",
          props.className,
        )}
      >
        {content}
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "setting-card-row",
        props.action_width === "content" && "setting-card-row--content-action",
        props.className,
      )}
    >
      <CardContent className="setting-card-row__content">{content}</CardContent>
    </Card>
  );
}
