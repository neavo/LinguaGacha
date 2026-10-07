import type { JSX } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import {
  QualityRuleCommandBar,
  type QualityRuleCommandBarProps,
} from "@frontend/features/quality-rule-editor/quality-rule-command-bar";
import { BooleanSegmentedToggle } from "@frontend/widgets/boolean-segmented-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";

type CustomPromptCommandBarProps = Omit<QualityRuleCommandBarProps, "hint" | "entry_actions"> & {
  enabled: boolean;
  on_toggle_enabled: (next_value: boolean) => Promise<boolean>;
};

/** 页面只提供启用或模式控件，公共操作由质量操作栏拥有。 */
export function CustomPromptCommandBar(props: CustomPromptCommandBarProps): JSX.Element {
  const { t } = useI18n();
  const toggle_state_key = props.enabled ? "app.state.enabled" : "app.state.disabled";
  const toggle_tooltip_title = t("app.tooltip.value", {
    TITLE: t("custom_prompt_page.title"),
    VALUE: t(toggle_state_key),
  });

  return (
    <QualityRuleCommandBar
      {...props}
      hint={
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="custom-prompt-page__toggle-cluster">
                <BooleanSegmentedToggle
                  aria_label={t("custom_prompt_page.title")}
                  value={props.enabled}
                  disabled={props.readonly}
                  on_value_change={(next_value) => {
                    void props.on_toggle_enabled(next_value);
                  }}
                />
              </div>
            }
          />
          <TooltipContent align="end" className="custom-prompt-page__toggle-tooltip">
            <div className="custom-prompt-page__toggle-tooltip-copy">
              <p className="custom-prompt-page__toggle-tooltip-title font-medium text-background">
                {toggle_tooltip_title}
              </p>
              <div
                className="custom-prompt-page__toggle-tooltip-html text-background/90"
                dangerouslySetInnerHTML={{
                  __html: t("custom_prompt_page.header.description_html"),
                }}
              />
            </div>
          </TooltipContent>
        </Tooltip>
      }
    />
  );
}
