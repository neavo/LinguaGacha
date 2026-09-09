import { PencilLine } from "lucide-react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  AppContextMenuContent,
  AppContextMenuGroup,
  AppContextMenuItem,
  AppContextMenuShortcut,
} from "@frontend/widgets/app-context-menu";

type TextPreserveContextMenuContentProps = {
  on_open_edit: () => void;
};
export function TextPreserveContextMenuContent(
  props: TextPreserveContextMenuContentProps,
): JSX.Element {
  const { t } = useI18n();

  return (
    <AppContextMenuContent>
      <AppContextMenuGroup>
        <AppContextMenuItem aria-keyshortcuts="Enter" onClick={props.on_open_edit}>
          <PencilLine />
          {t("app.action.edit")}
          <AppContextMenuShortcut>Enter</AppContextMenuShortcut>
        </AppContextMenuItem>
      </AppContextMenuGroup>
    </AppContextMenuContent>
  );
}
