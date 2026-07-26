import { FileDown, FileUp, Plus, Trash2 } from "lucide-react";

import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import { PresetMenu } from "@frontend/features/preset-editor/preset-menu";
import type { PresetItem } from "@frontend/features/preset-editor/preset-types";
import type { TextPreserveMode } from "@frontend/pages/text-preserve-page/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import {
  CommandBar,
  CommandBarGroup,
  CommandBarSeparator,
} from "@frontend/widgets/command-bar/command-bar";
import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import { ShortcutKbd } from "@frontend/widgets/interactions/shortcut-kbd";
import {
  SegmentedToggle,
  type SegmentedToggleOption,
} from "@frontend/widgets/segmented-toggle/segmented-toggle";

type TextPreserveCommandBarProps = {
  title_key: LocaleKey;
  mode: TextPreserveMode;
  mode_updating: boolean;
  preset_items: PresetItem[];
  preset_menu_open: boolean;
  selected_entry_count: number;
  readonly: boolean;
  on_mode_change: (next_mode: TextPreserveMode) => Promise<void>;
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

const MODE_LABEL_KEY_BY_MODE: Record<TextPreserveMode, LocaleKey> = {
  off: "text_preserve_page.mode.options.off",
  smart: "text_preserve_page.mode.options.smart",
  custom: "text_preserve_page.mode.options.custom",
};

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
  const mode_tooltip_title = t("quality_editor.toggle.status")
    .replace("{TITLE}", t("text_preserve_page.mode.label"))
    .replace("{STATE}", t(MODE_LABEL_KEY_BY_MODE[props.mode]));

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
      title={t(props.title_key)}
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
              {t("quality_editor.action.create")}
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
              {t("quality_editor.action.delete")}
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
              {t("quality_editor.action.import")}
            </AppButton>
            <AppButton
              variant="ghost"
              size="toolbar"
              onClick={() => {
                void props.on_export();
              }}
            >
              <FileUp data-icon="inline-start" />
              {t("quality_editor.action.export")}
            </AppButton>
          </CommandBarGroup>
          <CommandBarSeparator />
          <PresetMenu
            items={props.preset_items}
            open={props.preset_menu_open}
            readonly={props.readonly}
            trigger_label={t("quality_editor.action.preset")}
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
          <TooltipTrigger asChild>
            <div className="text-preserve-page__mode-cluster">
              <SegmentedToggle
                aria_label={t("text_preserve_page.mode.label")}
                className="text-preserve-page__mode-toggle"
                item_class_name="text-preserve-page__mode-toggle-item"
                size="sm"
                disabled={props.readonly || props.mode_updating}
                value={props.mode}
                options={mode_options}
                on_value_change={(next_value) => {
                  void props.on_mode_change(next_value);
                }}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="end"
            sideOffset={8}
            className="text-preserve-page__mode-tooltip"
          >
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
