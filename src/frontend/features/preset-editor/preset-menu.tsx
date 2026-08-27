import {
  FileDown,
  Folder,
  FolderHeart,
  FolderOpen,
  Heart,
  HeartOff,
  PencilLine,
  Recycle,
  Save,
  Trash2,
} from "lucide-react";

import { useI18n } from "@frontend/app/locale/locale-provider";
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
  items: readonly PresetItem[];
  open: boolean;
  readonly: boolean;
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
 * 同一预设只暴露“设为默认”或“取消默认”中的一个动作。
 */
function PresetDefaultMenuItem(props: {
  item: PresetItem;
  readonly: boolean;
  on_set_default: (virtual_id: string) => Promise<void>;
  on_cancel_default: () => Promise<void>;
}): JSX.Element {
  const { t } = useI18n();

  return props.item.is_default ? (
    <AppDropdownMenuItem
      disabled={props.readonly}
      onClick={() => {
        void props.on_cancel_default();
      }}
    >
      <HeartOff />
      {t("preset_editor.action.cancel_default")}
    </AppDropdownMenuItem>
  ) : (
    <AppDropdownMenuItem
      disabled={props.readonly}
      onClick={() => {
        void props.on_set_default(props.item.virtual_id);
      }}
    >
      <Heart />
      {t("preset_editor.action.set_default")}
    </AppDropdownMenuItem>
  );
}

/**
 * 共享菜单只编排预设动作；列表加载、确认和持久化仍由各页面状态 Hook 拥有。
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
          <AppButton variant="ghost" size="toolbar">
            <FolderOpen data-icon="inline-start" />
            {props.trigger_label}
          </AppButton>
        }
      />
      <AppDropdownMenuContent align="center">
        <AppDropdownMenuGroup>
          <AppDropdownMenuItem disabled={props.readonly} onClick={props.on_request_reset}>
            <Recycle />
            {t("app.action.reset")}
          </AppDropdownMenuItem>
          <AppDropdownMenuItem disabled={props.readonly} onClick={props.on_request_save}>
            <Save />
            {t("preset_editor.action.save")}
          </AppDropdownMenuItem>
        </AppDropdownMenuGroup>
        {builtin_items.length > 0 || user_items.length > 0 ? <AppDropdownMenuSeparator /> : null}
        {builtin_items.length > 0 ? (
          <AppDropdownMenuGroup>
            {builtin_items.map((item) => (
              <AppDropdownMenuSub key={item.virtual_id}>
                <AppDropdownMenuSubTrigger>
                  {item.is_default ? <FolderHeart /> : <Folder />}
                  {item.name}
                </AppDropdownMenuSubTrigger>
                <AppDropdownMenuSubContent>
                  <AppDropdownMenuItem
                    disabled={props.readonly}
                    onClick={() => {
                      void props.on_apply(item.virtual_id);
                    }}
                  >
                    <FileDown />
                    {t("preset_editor.action.apply")}
                  </AppDropdownMenuItem>
                  <AppDropdownMenuSeparator />
                  <PresetDefaultMenuItem
                    item={item}
                    readonly={props.readonly}
                    on_set_default={props.on_set_default}
                    on_cancel_default={props.on_cancel_default}
                  />
                </AppDropdownMenuSubContent>
              </AppDropdownMenuSub>
            ))}
          </AppDropdownMenuGroup>
        ) : null}
        {builtin_items.length > 0 && user_items.length > 0 ? <AppDropdownMenuSeparator /> : null}
        {user_items.length > 0 ? (
          <AppDropdownMenuGroup>
            {user_items.map((item) => (
              <AppDropdownMenuSub key={item.virtual_id}>
                <AppDropdownMenuSubTrigger>
                  {item.is_default ? <FolderHeart /> : <Folder />}
                  {item.name}
                </AppDropdownMenuSubTrigger>
                <AppDropdownMenuSubContent>
                  <AppDropdownMenuItem
                    disabled={props.readonly}
                    onClick={() => {
                      void props.on_apply(item.virtual_id);
                    }}
                  >
                    <FileDown />
                    {t("preset_editor.action.apply")}
                  </AppDropdownMenuItem>
                  <AppDropdownMenuItem
                    disabled={props.readonly}
                    onClick={() => {
                      props.on_request_rename(item);
                    }}
                  >
                    <PencilLine />
                    {t("preset_editor.action.rename")}
                  </AppDropdownMenuItem>
                  <AppDropdownMenuItem
                    variant="destructive"
                    disabled={props.readonly}
                    onClick={() => {
                      props.on_request_delete(item);
                    }}
                  >
                    <Trash2 />
                    {t("preset_editor.action.delete")}
                  </AppDropdownMenuItem>
                  <AppDropdownMenuSeparator />
                  <PresetDefaultMenuItem
                    item={item}
                    readonly={props.readonly}
                    on_set_default={props.on_set_default}
                    on_cancel_default={props.on_cancel_default}
                  />
                </AppDropdownMenuSubContent>
              </AppDropdownMenuSub>
            ))}
          </AppDropdownMenuGroup>
        ) : null}
      </AppDropdownMenuContent>
    </AppDropdownMenu>
  );
}
