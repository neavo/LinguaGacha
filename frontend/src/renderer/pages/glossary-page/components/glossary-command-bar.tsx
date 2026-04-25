import {
  Heart,
  HeartOff,
  FileDown,
  FileUp,
  Folder,
  FolderHeart,
  FolderOpen,
  Plus,
  Recycle,
  Save,
  PencilLine,
  Trash2,
} from "lucide-react";

import { useI18n } from "@/i18n";
import type { GlossaryPresetItem } from "@/pages/glossary-page/types";
import { Button } from "@/shadcn/button";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuGroup,
  AppDropdownMenuItem,
  AppDropdownMenuSeparator,
  AppDropdownMenuSub,
  AppDropdownMenuSubContent,
  AppDropdownMenuSubTrigger,
  AppDropdownMenuTrigger,
} from "@/widgets/app-dropdown-menu/app-dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shadcn/tooltip";
import {
  CommandBar,
  CommandBarGroup,
  CommandBarSeparator,
} from "@/widgets/command-bar/command-bar";
import { SegmentedToggle } from "@/widgets/segmented-toggle/segmented-toggle";

type GlossaryCommandBarProps = {
  enabled: boolean;
  preset_items: GlossaryPresetItem[];
  preset_menu_open: boolean;
  selected_entry_count: number;
  on_toggle_enabled: (next_value: boolean) => Promise<void>;
  on_create: () => void;
  on_delete_selected: () => Promise<void>;
  on_import: () => Promise<void>;
  on_export: () => Promise<void>;
  on_open_preset_menu: () => Promise<void>;
  on_apply_preset: (virtual_id: string) => Promise<void>;
  on_request_reset: () => void;
  on_request_save_preset: () => void;
  on_request_rename_preset: (preset_item: GlossaryPresetItem) => void;
  on_request_delete_preset: (preset_item: GlossaryPresetItem) => void;
  on_set_default_preset: (virtual_id: string) => Promise<void>;
  on_cancel_default_preset: () => Promise<void>;
  on_preset_menu_open_change: (next_open: boolean) => void;
};

export function GlossaryCommandBar(props: GlossaryCommandBarProps): JSX.Element {
  const { t } = useI18n();
  const boolean_segmented_options = [
    {
      value: "disabled",
      label: t("app.toggle.disabled"),
    },
    {
      value: "enabled",
      label: t("app.toggle.enabled"),
    },
  ] as const;
  const builtin_preset_items = props.preset_items.filter((item) => item.type === "builtin");
  const user_preset_items = props.preset_items.filter((item) => item.type === "user");
  const toggle_state_key = props.enabled ? "app.toggle.enabled" : "app.toggle.disabled";
  const toggle_tooltip_title = t("glossary_page.toggle.status")
    .replace("{TITLE}", t("glossary_page.title"))
    .replace("{STATE}", t(toggle_state_key));

  return (
    <CommandBar
      title={t("glossary_page.title")}
      actions={
        <>
          <CommandBarGroup>
            <Button variant="ghost" size="toolbar" onClick={props.on_create}>
              <Plus data-icon="inline-start" />
              {t("glossary_page.action.create")}
            </Button>
            <Button
              variant="ghost"
              size="toolbar"
              disabled={props.selected_entry_count === 0}
              onClick={() => {
                void props.on_delete_selected();
              }}
            >
              <Trash2 data-icon="inline-start" />
              {t("glossary_page.action.delete")}
            </Button>
          </CommandBarGroup>
          <CommandBarSeparator />
          <CommandBarGroup>
            <Button
              variant="ghost"
              size="toolbar"
              onClick={() => {
                void props.on_import();
              }}
            >
              <FileDown data-icon="inline-start" />
              {t("glossary_page.action.import")}
            </Button>
            <Button
              variant="ghost"
              size="toolbar"
              onClick={() => {
                void props.on_export();
              }}
            >
              <FileUp data-icon="inline-start" />
              {t("glossary_page.action.export")}
            </Button>
          </CommandBarGroup>
          <CommandBarSeparator />
          <AppDropdownMenu
            open={props.preset_menu_open}
            onOpenChange={(next_open) => {
              props.on_preset_menu_open_change(next_open);
              if (next_open) {
                void props.on_open_preset_menu();
              }
            }}
          >
            <AppDropdownMenuTrigger asChild>
              <Button variant="ghost" size="toolbar">
                <FolderOpen data-icon="inline-start" />
                {t("glossary_page.action.preset")}
              </Button>
            </AppDropdownMenuTrigger>
            <AppDropdownMenuContent align="center">
              <AppDropdownMenuGroup>
                <AppDropdownMenuItem
                  onSelect={() => {
                    props.on_request_reset();
                  }}
                >
                  <Recycle />
                  {t("app.action.reset")}
                </AppDropdownMenuItem>
                <AppDropdownMenuItem
                  onSelect={() => {
                    props.on_request_save_preset();
                  }}
                >
                  <Save />
                  {t("glossary_page.preset.save")}
                </AppDropdownMenuItem>
              </AppDropdownMenuGroup>
              {builtin_preset_items.length > 0 || user_preset_items.length > 0 ? (
                <AppDropdownMenuSeparator />
              ) : null}
              {builtin_preset_items.length > 0 ? (
                <AppDropdownMenuGroup>
                  {builtin_preset_items.map((item) => (
                    <AppDropdownMenuSub key={item.virtual_id}>
                      <AppDropdownMenuSubTrigger>
                        {item.is_default ? <FolderHeart /> : <Folder />}
                        {item.name}
                      </AppDropdownMenuSubTrigger>
                      <AppDropdownMenuSubContent>
                        <AppDropdownMenuItem
                          onSelect={() => {
                            void props.on_apply_preset(item.virtual_id);
                          }}
                        >
                          <FileDown />
                          {t("glossary_page.preset.apply")}
                        </AppDropdownMenuItem>
                        <AppDropdownMenuSeparator />
                        {item.is_default ? (
                          <AppDropdownMenuItem
                            onSelect={() => {
                              void props.on_cancel_default_preset();
                            }}
                          >
                            <HeartOff />
                            {t("glossary_page.preset.cancel_default")}
                          </AppDropdownMenuItem>
                        ) : (
                          <AppDropdownMenuItem
                            onSelect={() => {
                              void props.on_set_default_preset(item.virtual_id);
                            }}
                          >
                            <Heart />
                            {t("glossary_page.preset.set_default")}
                          </AppDropdownMenuItem>
                        )}
                      </AppDropdownMenuSubContent>
                    </AppDropdownMenuSub>
                  ))}
                </AppDropdownMenuGroup>
              ) : null}
              {builtin_preset_items.length > 0 && user_preset_items.length > 0 ? (
                <AppDropdownMenuSeparator />
              ) : null}
              {user_preset_items.length > 0 ? (
                <AppDropdownMenuGroup>
                  {user_preset_items.map((item) => (
                    <AppDropdownMenuSub key={item.virtual_id}>
                      <AppDropdownMenuSubTrigger>
                        {item.is_default ? <FolderHeart /> : <Folder />}
                        {item.name}
                      </AppDropdownMenuSubTrigger>
                      <AppDropdownMenuSubContent>
                        <AppDropdownMenuItem
                          onSelect={() => {
                            void props.on_apply_preset(item.virtual_id);
                          }}
                        >
                          <FileDown />
                          {t("glossary_page.preset.apply")}
                        </AppDropdownMenuItem>
                        <AppDropdownMenuItem
                          onSelect={() => {
                            props.on_request_rename_preset(item);
                          }}
                        >
                          <PencilLine />
                          {t("glossary_page.preset.rename")}
                        </AppDropdownMenuItem>
                        <AppDropdownMenuItem
                          onSelect={() => {
                            props.on_request_delete_preset(item);
                          }}
                        >
                          <Trash2 />
                          {t("glossary_page.preset.delete")}
                        </AppDropdownMenuItem>
                        <AppDropdownMenuSeparator />
                        {item.is_default ? (
                          <AppDropdownMenuItem
                            onSelect={() => {
                              void props.on_cancel_default_preset();
                            }}
                          >
                            <HeartOff />
                            {t("glossary_page.preset.cancel_default")}
                          </AppDropdownMenuItem>
                        ) : (
                          <AppDropdownMenuItem
                            onSelect={() => {
                              void props.on_set_default_preset(item.virtual_id);
                            }}
                          >
                            <Heart />
                            {t("glossary_page.preset.set_default")}
                          </AppDropdownMenuItem>
                        )}
                      </AppDropdownMenuSubContent>
                    </AppDropdownMenuSub>
                  ))}
                </AppDropdownMenuGroup>
              ) : null}
            </AppDropdownMenuContent>
          </AppDropdownMenu>
        </>
      }
      hint={
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="glossary-page__toggle-cluster">
              <SegmentedToggle
                aria_label={t("glossary_page.title")}
                size="sm"
                value={props.enabled ? "enabled" : "disabled"}
                options={boolean_segmented_options}
                on_value_change={(next_value) => {
                  void props.on_toggle_enabled(next_value === "enabled");
                }}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="end"
            sideOffset={8}
            className="glossary-page__toggle-tooltip"
          >
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
