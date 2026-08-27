import { FileDown, FileUp } from "lucide-react";

import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import { PresetMenu } from "@frontend/features/preset-editor/preset-menu";
import type { PresetItem } from "@frontend/features/preset-editor/preset-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import { BooleanSegmentedToggle } from "@frontend/widgets/boolean-segmented-toggle";
import {
  CommandBar,
  CommandBarGroup,
  CommandBarSeparator,
} from "@frontend/widgets/command-bar/command-bar";

type CustomPromptCommandBarProps = {
  title_key: LocaleKey;
  header_title_key: LocaleKey;
  header_description_key: LocaleKey;
  enabled: boolean;
  preset_items: PresetItem[];
  preset_menu_open: boolean;
  readonly: boolean;
  on_toggle_enabled: (next_value: boolean) => Promise<boolean>;
  on_import: () => Promise<void>;
  on_export: () => Promise<void>;
  on_open_preset_menu: () => Promise<void>;
  on_apply_preset: (virtual_id: string) => Promise<void>;
  on_request_reset: () => void;
  on_request_save_preset: () => void;
  on_request_rename_preset: (preset_item: PresetItem) => void;
  on_request_delete_preset: (preset_item: PresetItem) => void;
  on_set_default_preset: (virtual_id: string) => Promise<void>;
  on_cancel_default_preset: () => Promise<void>;
  on_preset_menu_open_change: (next_open: boolean) => void;
};

export function CustomPromptCommandBar(props: CustomPromptCommandBarProps): JSX.Element {
  const { t } = useI18n();
  const toggle_state_key = props.enabled ? "app.state.enabled" : "app.state.disabled";
  const toggle_tooltip_title = t("app.tooltip.value", {
    TITLE: t(props.header_title_key),
    VALUE: t(toggle_state_key),
  });

  return (
    <CommandBar
      actions={
        <>
          <CommandBarGroup>
            <AppButton
              variant="ghost"
              size="toolbar"
              disabled={props.readonly}
              onClick={() => {
                void props.on_import();
              }}
            >
              <FileDown data-icon="inline-start" />
              {t("app.action.import")}
            </AppButton>
            <AppButton
              variant="ghost"
              size="toolbar"
              onClick={() => {
                void props.on_export();
              }}
            >
              <FileUp data-icon="inline-start" />
              {t("app.action.export")}
            </AppButton>
          </CommandBarGroup>
          <CommandBarSeparator />
          <PresetMenu
            items={props.preset_items}
            open={props.preset_menu_open}
            readonly={props.readonly}
            trigger_label={t("app.action.preset")}
            on_open={props.on_open_preset_menu}
            on_open_change={props.on_preset_menu_open_change}
            on_apply={props.on_apply_preset}
            on_request_reset={props.on_request_reset}
            on_request_save={props.on_request_save_preset}
            on_request_rename={props.on_request_rename_preset}
            on_request_delete={props.on_request_delete_preset}
            on_set_default={props.on_set_default_preset}
            on_cancel_default={props.on_cancel_default_preset}
          />
        </>
      }
      hint={
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="custom-prompt-page__toggle-cluster">
                <BooleanSegmentedToggle
                  aria_label={t(props.header_title_key)}
                  value={props.enabled}
                  disabled={props.readonly}
                  on_value_change={(next_value) => {
                    void props.on_toggle_enabled(next_value);
                  }}
                />
              </div>
            }
          />
          <TooltipContent
            side="top"
            align="end"
            sideOffset={8}
            className="custom-prompt-page__toggle-tooltip"
          >
            <div className="custom-prompt-page__toggle-tooltip-copy">
              <p className="custom-prompt-page__toggle-tooltip-title font-medium text-background">
                {toggle_tooltip_title}
              </p>
              <div
                className="custom-prompt-page__toggle-tooltip-html text-background/90"
                dangerouslySetInnerHTML={{
                  __html: t(props.header_description_key),
                }}
              />
            </div>
          </TooltipContent>
        </Tooltip>
      }
    />
  );
}
