import { CircleEllipsis, Recycle, Trash2 } from "lucide-react";

import { Button } from "@/shadcn/button";
import { ContextMenuContent, ContextMenuGroup, ContextMenuItem } from "@/shadcn/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shadcn/dropdown-menu";
import { useI18n } from "@/i18n";

type WorkbenchTableActionMenuProps = {
  disabled: boolean;
  on_prepare_open: () => void;
  on_reset: () => void;
  on_delete: () => void;
};

type WorkbenchTableMenuActionProps = {
  disabled: boolean;
  on_reset: () => void;
};

type WorkbenchTableActionMenuContentProps = WorkbenchTableMenuActionProps & {
  on_delete: () => void;
};

function WorkbenchTableActionMenuContent(props: WorkbenchTableActionMenuContentProps): JSX.Element {
  const { t } = useI18n();
  const menu_item_class_name = "whitespace-nowrap";

  return (
    <DropdownMenuGroup>
      <DropdownMenuItem
        className={menu_item_class_name}
        disabled={props.disabled}
        onClick={props.on_reset}
      >
        <Recycle data-icon="inline-start" />
        {t("workbench_page.action.reset")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className={menu_item_class_name}
        disabled={props.disabled}
        variant="destructive"
        onClick={props.on_delete}
      >
        <Trash2 data-icon="inline-start" />
        {t("workbench_page.action.delete")}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

export function WorkbenchTableActionMenu(props: WorkbenchTableActionMenuProps): JSX.Element {
  const { t } = useI18n();

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(next_open) => {
        if (next_open) {
          props.on_prepare_open();
        }
      }}
    >
      <DropdownMenuTrigger asChild>
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <WorkbenchTableActionMenuContent
          disabled={props.disabled}
          on_reset={props.on_reset}
          on_delete={props.on_delete}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WorkbenchTableContextMenuContent(
  props: WorkbenchTableMenuActionProps,
): JSX.Element {
  const { t } = useI18n();
  const menu_item_class_name = "whitespace-nowrap";
  const menu_content_class_name = "w-auto min-w-max";

  return (
    <ContextMenuContent className={menu_content_class_name}>
      <ContextMenuGroup>
        <ContextMenuItem
          className={menu_item_class_name}
          disabled={props.disabled}
          onClick={props.on_reset}
        >
          <Recycle data-icon="inline-start" />
          {t("workbench_page.action.reset")}
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  );
}
