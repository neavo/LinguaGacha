import { CircleEllipsis, Recycle } from "lucide-react";

import { AppButton } from "@frontend/widgets/app-button";
import { AppContextMenuGroup, AppContextMenuItem } from "@frontend/widgets/app-context-menu";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuGroup,
  AppDropdownMenuItem,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import { useI18n } from "@frontend/app/locale/locale-provider";

type WorkbenchTableActionMenuProps = {
  disabled: boolean;
  on_prepare_open: () => void;
  on_reset: () => void;
};

type WorkbenchTableMenuActionProps = {
  disabled: boolean;
  on_reset: () => void;
};
/** 菜单打开时先准备操作目标，避免重置沿用上一组选区。 */
export function WorkbenchTableActionMenu(props: WorkbenchTableActionMenuProps): JSX.Element {
  const { t } = useI18n();

  return (
    <AppDropdownMenu
      modal={false}
      onOpenChange={(next_open) => {
        if (next_open) {
          props.on_prepare_open();
        }
      }}
    >
      <AppDropdownMenuTrigger
        render={
          <AppButton
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={props.disabled}
            className="workbench-page__row-action"
            aria-label={t("workbench_page.table.actions")}
            data-app-table-ignore-row-click="true"
            data-app-table-ignore-box-select="true"
          >
            <CircleEllipsis data-icon="inline-start" />
          </AppButton>
        }
      />
      <AppDropdownMenuContent align="center">
        <AppDropdownMenuGroup>
          <AppDropdownMenuItem disabled={props.disabled} onClick={props.on_reset}>
            <Recycle data-icon="inline-start" />
            {t("workbench_page.action.reset")}
          </AppDropdownMenuItem>
        </AppDropdownMenuGroup>
      </AppDropdownMenuContent>
    </AppDropdownMenu>
  );
}
/** 右键目标由表格提前裁决，此处只提供工作台业务动作。 */
export function WorkbenchTableContextMenuItems(props: WorkbenchTableMenuActionProps): JSX.Element {
  const { t } = useI18n();

  return (
    <AppContextMenuGroup>
      <AppContextMenuItem disabled={props.disabled} onClick={props.on_reset}>
        <Recycle data-icon="inline-start" />
        {t("workbench_page.action.reset")}
      </AppContextMenuItem>
    </AppContextMenuGroup>
  );
}
