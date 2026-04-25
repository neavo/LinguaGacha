import { CircleEllipsis, Recycle } from "lucide-react";

import { Button } from "@/shadcn/button";
import {
  AppContextMenuContent,
  AppContextMenuGroup,
  AppContextMenuItem,
} from "@/widgets/app-context-menu/app-context-menu";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuGroup,
  AppDropdownMenuItem,
  AppDropdownMenuTrigger,
} from "@/widgets/app-dropdown-menu/app-dropdown-menu";
import { useI18n } from "@/i18n";

type WorkbenchTableActionMenuProps = {
  disabled: boolean;
  on_prepare_open: () => void;
  on_reset: () => void;
};

type WorkbenchTableMenuActionProps = {
  disabled: boolean;
  on_reset: () => void;
};

function WorkbenchTableActionMenuContent(props: WorkbenchTableMenuActionProps): JSX.Element {
  const { t } = useI18n();

  return (
    <AppDropdownMenuGroup>
      <AppDropdownMenuItem disabled={props.disabled} onClick={props.on_reset}>
        <Recycle data-icon="inline-start" />
        {t("workbench_page.action.reset")}
      </AppDropdownMenuItem>
    </AppDropdownMenuGroup>
  );
}

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
      <AppDropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={props.disabled}
          className="workbench-page__row-action"
          aria-label={t("workbench_page.table.open_actions")}
          data-workbench-ignore-row-click="true"
          data-workbench-ignore-box-select="true"
        >
          <CircleEllipsis data-icon="inline-start" />
        </Button>
      </AppDropdownMenuTrigger>
      <AppDropdownMenuContent align="center">
        <WorkbenchTableActionMenuContent disabled={props.disabled} on_reset={props.on_reset} />
      </AppDropdownMenuContent>
    </AppDropdownMenu>
  );
}

export function WorkbenchTableContextMenuContent(
  props: WorkbenchTableMenuActionProps,
): JSX.Element {
  const { t } = useI18n();

  return (
    <AppContextMenuContent>
      <AppContextMenuGroup>
        <AppContextMenuItem disabled={props.disabled} onClick={props.on_reset}>
          <Recycle data-icon="inline-start" />
          {t("workbench_page.action.reset")}
        </AppContextMenuItem>
      </AppContextMenuGroup>
    </AppContextMenuContent>
  );
}
