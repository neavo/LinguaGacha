import type { JSX } from "react";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import {
  QualityRuleCommandBar,
  type QualityRuleCommandBarProps,
  type QualityRuleEntryActions,
} from "@frontend/features/quality-rule-editor/quality-rule-command-bar";
import type { TextPreserveMode } from "@frontend/pages/text-preserve-page/types";
import { SegmentedToggle, type SegmentedToggleOption } from "@frontend/shadcn/segmented-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";

type TextPreserveCommandBarProps = Omit<QualityRuleCommandBarProps, "hint" | "entry_actions"> &
  Omit<QualityRuleEntryActions, "create_label"> & {
    mode: TextPreserveMode;
    mode_updating: boolean;
    on_mode_change: (next_mode: TextPreserveMode) => Promise<void>;
  };

const MODE_LABEL_KEY_BY_MODE: Record<TextPreserveMode, LocaleKey> = {
  off: "text_preserve_page.mode.options.off",
  smart: "text_preserve_page.mode.options.smart",
  custom: "text_preserve_page.mode.options.custom",
};

/** 页面只提供启用或模式控件，公共操作由质量操作栏拥有。 */
export function TextPreserveCommandBar(props: TextPreserveCommandBarProps): JSX.Element {
  const { t } = useI18n();
  const mode_options: readonly SegmentedToggleOption<TextPreserveMode>[] = [
    {
      value: "off",
      label: t("text_preserve_page.mode.options.off"),
    },
    {
      value: "smart",
      label: t("text_preserve_page.mode.options.smart"),
    },
    {
      value: "custom",
      label: t("text_preserve_page.mode.options.custom"),
    },
  ];
  const mode_tooltip_title = t("app.tooltip.value", {
    TITLE: t("text_preserve_page.mode.label"),
    VALUE: t(MODE_LABEL_KEY_BY_MODE[props.mode]),
  });

  return (
    <QualityRuleCommandBar
      {...props}
      entry_actions={{
        create_label: "app.action.create",
        selected_entry_count: props.selected_entry_count,
        on_create: props.on_create,
        on_delete_selected: props.on_delete_selected,
      }}
      hint={
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="text-preserve-page__mode-cluster">
                <SegmentedToggle
                  aria_label={t("text_preserve_page.mode.label")}
                  className="text-preserve-page__mode-toggle"
                  disabled={props.readonly || props.mode_updating}
                  value={props.mode}
                  options={mode_options}
                  on_value_change={(next_value) => {
                    void props.on_mode_change(next_value);
                  }}
                />
              </div>
            }
          />
          <TooltipContent align="end" className="text-preserve-page__mode-tooltip">
            <div className="text-preserve-page__mode-tooltip-copy">
              <p className="text-preserve-page__mode-tooltip-title font-medium text-background">
                {mode_tooltip_title}
              </p>
              <div
                className="text-preserve-page__mode-tooltip-html text-background/90"
                dangerouslySetInnerHTML={{
                  __html: t("text_preserve_page.mode.content_html"),
                }}
              />
            </div>
          </TooltipContent>
        </Tooltip>
      }
    />
  );
}
