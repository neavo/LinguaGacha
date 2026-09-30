import type { JSX } from "react";
import { Copy, GraduationCap, ListTodo, Recycle, SlidersHorizontal, Trash2 } from "lucide-react";

import { Model } from "@domain/model";
import { useI18n } from "@frontend/app/locale/locale-context";
import type { ModelDialogState, ModelEntrySnapshot } from "@frontend/pages/model-page/types";
import { ChatGPTAccountMenu } from "./chatgpt-account-menu";
import {
  AppDropdownMenuContent,
  AppDropdownMenuGroup,
  AppDropdownMenuItem,
  AppDropdownMenuSeparator,
} from "@frontend/widgets/app-dropdown-menu";

type ModelItemMenuProps = {
  model: ModelEntrySnapshot;
  readonly: boolean;
  auth_disabled: boolean;
  on_open_settings: (kind: Exclude<ModelDialogState["kind"], null>) => void;
  on_copy: () => void;
  on_reset: () => void;
  on_delete: () => void;
  on_logout: () => void;
};

/** 菜单拥有操作可见性；运行忙碌时仍允许查看只读设置。 */
export function ModelItemMenu(props: ModelItemMenuProps): JSX.Element {
  const { t } = useI18n();
  const model_actions = (
    <AppDropdownMenuGroup>
      <AppDropdownMenuItem onClick={() => props.on_open_settings("basic")}>
        <SlidersHorizontal />
        {t("model_page.action.basic_settings")}
      </AppDropdownMenuItem>
      <AppDropdownMenuItem onClick={() => props.on_open_settings("task")}>
        <ListTodo />
        {t("model_page.action.task_settings")}
      </AppDropdownMenuItem>
      <AppDropdownMenuItem onClick={() => props.on_open_settings("advanced")}>
        <GraduationCap />
        {t("model_page.action.advanced_settings")}
      </AppDropdownMenuItem>
      <AppDropdownMenuSeparator />
      {Model.resolve_custom_type(props.model.api_format) !== null ? (
        <>
          <AppDropdownMenuItem disabled={props.readonly} onClick={props.on_copy}>
            <Copy />
            {t("model_page.action.copy")}
          </AppDropdownMenuItem>
          <AppDropdownMenuSeparator />
        </>
      ) : null}
      {props.model.can_reset ? (
        <AppDropdownMenuItem
          variant="destructive"
          disabled={props.readonly}
          onClick={props.on_reset}
        >
          <Recycle />
          {t("model_page.action.reset")}
        </AppDropdownMenuItem>
      ) : (
        <AppDropdownMenuItem
          variant="destructive"
          disabled={props.readonly}
          onClick={props.on_delete}
        >
          <Trash2 />
          {t("model_page.action.delete")}
        </AppDropdownMenuItem>
      )}
    </AppDropdownMenuGroup>
  );

  return (
    <AppDropdownMenuContent align="center">
      {props.model.auth_type === "oauth" ? (
        <ChatGPTAccountMenu readonly={props.auth_disabled} on_logout={props.on_logout}>
          {model_actions}
        </ChatGPTAccountMenu>
      ) : (
        model_actions
      )}
    </AppDropdownMenuContent>
  );
}
