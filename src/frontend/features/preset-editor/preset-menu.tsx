import { Fragment, type JSX } from "react";
import {
  FileInput,
  FileText,
  FileCheck2,
  Files,
  Pin,
  PinOff,
  PencilLine,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";

import { useI18n } from "@frontend/app/locale/locale-context";
import { AppButton } from "@frontend/widgets/app-button";
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
} from "@frontend/widgets/app-dropdown-menu";

import type { PresetItem } from "./preset-types";

type PresetMenuProps = {
  disabled: boolean;
  items: readonly PresetItem[];
  open: boolean;
  project_write_disabled: boolean;
  trigger_label: string;
  on_open: () => Promise<void>;
  on_open_change: (next_open: boolean) => void;
  on_apply: (virtual_id: string) => Promise<void>;
  on_request_reset: () => void;
  on_request_save: () => void;
  on_request_rename: (preset_item: PresetItem) => void;
  on_request_delete: (preset_item: PresetItem) => void;
  on_set_default: (virtual_id: string) => Promise<void>;
  on_cancel_default: () => Promise<void>;
};

/**
 * 共享菜单只编排预设动作。页面状态 Hook 负责加载、确认和持久化。
 * 默认标记表示新建工程的加载选择，不代表当前工程已应用该预设。
 */
export function PresetMenu(props: PresetMenuProps): JSX.Element {
  const { t } = useI18n();
  const builtin_items = props.items.filter((item) => item.type === "builtin");
  const user_items = props.items.filter((item) => item.type === "user");

  return (
    <AppDropdownMenu
      open={props.open}
      onOpenChange={(next_open) => {
        props.on_open_change(next_open);
        if (next_open) {
          void props.on_open();
        }
      }}
    >
      <AppDropdownMenuTrigger
        render={
          <AppButton variant="ghost" size="toolbar" disabled={props.disabled}>
            <Files data-icon="inline-start" />
            {props.trigger_label}
          </AppButton>
        }
      />
      <AppDropdownMenuContent align="center" className="min-w-[240px]">
        <AppDropdownMenuGroup>
          <AppDropdownMenuItem
            disabled={props.project_write_disabled}
            onClick={props.on_request_reset}
          >
            <RotateCcw />
            {t("app.action.reset")}
          </AppDropdownMenuItem>
          <AppDropdownMenuItem onClick={props.on_request_save}>
            <Save />
            {t("preset_editor.action.save")}
          </AppDropdownMenuItem>
        </AppDropdownMenuGroup>
        {[builtin_items, user_items]
          .filter((items) => items.length > 0)
          .map((items) => (
            <Fragment key={items[0]?.type}>
              <AppDropdownMenuSeparator />
              <AppDropdownMenuGroup>
                {items.map((item) => (
                  <AppDropdownMenuSub key={item.virtual_id}>
                    <AppDropdownMenuSubTrigger>
                      {item.is_default ? <FileCheck2 /> : <FileText />}
                      {item.name}
                    </AppDropdownMenuSubTrigger>
                    <AppDropdownMenuSubContent>
                      <AppDropdownMenuItem
                        disabled={props.project_write_disabled}
                        onClick={() => {
                          void props.on_apply(item.virtual_id);
                        }}
                      >
                        <FileInput />
                        {t("preset_editor.action.apply")}
                      </AppDropdownMenuItem>
                      {item.type === "user" ? (
                        <>
                          <AppDropdownMenuItem
                            onClick={() => {
                              props.on_request_rename(item);
                            }}
                          >
                            <PencilLine />
                            {t("preset_editor.action.rename")}
                          </AppDropdownMenuItem>
                          <AppDropdownMenuItem
                            variant="destructive"
                            onClick={() => {
                              props.on_request_delete(item);
                            }}
                          >
                            <Trash2 />
                            {t("preset_editor.action.delete")}
                          </AppDropdownMenuItem>
                        </>
                      ) : null}
                      <AppDropdownMenuSeparator />
                      <AppDropdownMenuItem
                        onClick={() => {
                          if (item.is_default) void props.on_cancel_default();
                          else void props.on_set_default(item.virtual_id);
                        }}
                      >
                        {item.is_default ? <PinOff /> : <Pin />}
                        {t(
                          item.is_default
                            ? "preset_editor.action.cancel_default"
                            : "preset_editor.action.set_default",
                        )}
                      </AppDropdownMenuItem>
                    </AppDropdownMenuSubContent>
                  </AppDropdownMenuSub>
                ))}
              </AppDropdownMenuGroup>
            </Fragment>
          ))}
      </AppDropdownMenuContent>
    </AppDropdownMenu>
  );
}
