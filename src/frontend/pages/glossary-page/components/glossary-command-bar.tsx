import type { JSX } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import {
  QualityRuleCommandBar,
  type QualityRuleCommandBarProps,
  type QualityRuleEntryActions,
} from "@frontend/features/quality-rule-editor/quality-rule-command-bar";
import { BooleanSegmentedToggle } from "@frontend/widgets/boolean-segmented-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";

type GlossaryCommandBarProps = Omit<QualityRuleCommandBarProps, "hint" | "entry_actions"> &
  Omit<QualityRuleEntryActions, "create_label"> & {
    enabled: boolean;
    on_toggle_enabled: (next_value: boolean) => Promise<void>;
  };

/** 页面只提供启用或模式控件，公共操作由质量操作栏拥有。 */
export function GlossaryCommandBar(props: GlossaryCommandBarProps): JSX.Element {
  const { t } = useI18n();
  const toggle_state_key = props.enabled ? "app.state.enabled" : "app.state.disabled";
  const toggle_tooltip_title = t("app.tooltip.value", {
    TITLE: t("glossary_page.title"),
    VALUE: t(toggle_state_key),
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
              <div className="glossary-page__toggle-cluster">
                <BooleanSegmentedToggle
                  aria_label={t("glossary_page.title")}
                  value={props.enabled}
                  disabled={props.readonly}
                  on_value_change={(next_value) => {
                    void props.on_toggle_enabled(next_value);
                  }}
                />
              </div>
            }
          />
          <TooltipContent align="end" className="glossary-page__toggle-tooltip">
            <div className="glossary-page__toggle-tooltip-copy">
              <p className="glossary-page__toggle-tooltip-title font-medium">
                {toggle_tooltip_title}
              </p>
              <p>{t("glossary_page.toggle.tooltip")}</p>
            </div>
          </TooltipContent>
        </Tooltip>
      }
    />
  );
}
