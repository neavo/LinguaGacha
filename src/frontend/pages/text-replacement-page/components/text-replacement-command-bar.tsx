import { FileDown, FileUp, Plus, Trash2 } from "lucide-react";

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
import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import { ShortcutKbd } from "@frontend/widgets/interactions/shortcut-kbd";

type TextReplacementCommandBarProps = {
  title_key: LocaleKey;
  enabled: boolean;
  preset_items: PresetItem[];
  preset_menu_open: boolean;
  selected_entry_count: number;
  readonly: boolean;
  on_toggle_enabled: (next_value: boolean) => Promise<void>;
  on_create: () => void;
  on_delete_selected: () => Promise<void>;
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

export function TextReplacementCommandBar(props: TextReplacementCommandBarProps): JSX.Element {
  const { t } = useI18n();
  const toggle_state_key = props.enabled ? "app.state.enabled" : "app.state.disabled";
  const toggle_tooltip_title = t("app.tooltip.value", {
    TITLE: t(props.title_key),
    VALUE: t(toggle_state_key),
  });

  useActionShortcut({
    action: "create",
    enabled: !props.readonly,
    on_trigger: props.on_create,
  });
  useActionShortcut({
    action: "delete",
    enabled: !props.readonly && props.selected_entry_count > 0,
    on_trigger: () => {
      void props.on_delete_selected();
    },
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
              onClick={props.on_create}
            >
              <Plus data-icon="inline-start" />
              {t("app.action.add")}
              <ShortcutKbd action="create" />
            </AppButton>
            <AppButton
              variant="ghost"
              size="toolbar"
              disabled={props.readonly || props.selected_entry_count === 0}
              onClick={() => {
                void props.on_delete_selected();
              }}
            >
              <Trash2 data-icon="inline-start" />
              {t("app.action.delete")}
              <ShortcutKbd action="delete" />
            </AppButton>
          </CommandBarGroup>
          <CommandBarSeparator />
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
              <div className="text-replacement-page__toggle-cluster">
                <BooleanSegmentedToggle
                  aria_label={t(props.title_key)}
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
            className="text-replacement-page__toggle-tooltip"
          >
            <div className="text-replacement-page__toggle-tooltip-copy">
              <p className="text-replacement-page__toggle-tooltip-title font-medium text-background">
                {toggle_tooltip_title}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      }
    />
  );
}
