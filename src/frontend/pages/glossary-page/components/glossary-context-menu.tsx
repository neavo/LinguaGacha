import type { JSX } from "react";
import { CaseSensitive, PencilLine } from "lucide-react";

import { useI18n } from "@frontend/app/locale/locale-context";
import {
  AppContextMenuGroup,
  AppContextMenuItem,
  AppContextMenuShortcut,
  AppContextMenuRadioGroup,
  AppContextMenuRadioItem,
  AppContextMenuSub,
  AppContextMenuSubContent,
  AppContextMenuSubTrigger,
} from "@frontend/widgets/app-context-menu";

type GlossaryContextMenuItemsProps = {
  case_sensitive_state: "enabled" | "disabled" | "mixed";
  readonly: boolean;
  on_open_edit: () => void;
  on_toggle_case_sensitive: (next_value: boolean) => Promise<void>;
};
/** 业务菜单消费整组选区的规则状态，写入交给页面回调。 */
export function GlossaryContextMenuItems(props: GlossaryContextMenuItemsProps): JSX.Element {
  const { t } = useI18n();

  return (
    <AppContextMenuGroup>
      <AppContextMenuItem aria-keyshortcuts="Enter" onClick={props.on_open_edit}>
        <PencilLine />
        {t("app.action.edit")}
        <AppContextMenuShortcut>Enter</AppContextMenuShortcut>
      </AppContextMenuItem>
      <AppContextMenuSub>
        <AppContextMenuSubTrigger disabled={props.readonly}>
          <CaseSensitive />
          {t("glossary_page.rule.case_sensitive")}
        </AppContextMenuSubTrigger>
        <AppContextMenuSubContent>
          <AppContextMenuRadioGroup
            value={props.case_sensitive_state}
            onValueChange={(next_value) => {
              if (next_value === "enabled") {
                void props.on_toggle_case_sensitive(true);
              } else if (next_value === "disabled") {
                void props.on_toggle_case_sensitive(false);
              }
            }}
          >
            <AppContextMenuRadioItem value="enabled">
              {t("app.toggle.option.enabled")}
            </AppContextMenuRadioItem>
            <AppContextMenuRadioItem value="disabled">
              {t("app.toggle.option.disabled")}
            </AppContextMenuRadioItem>
          </AppContextMenuRadioGroup>
        </AppContextMenuSubContent>
      </AppContextMenuSub>
    </AppContextMenuGroup>
  );
}
