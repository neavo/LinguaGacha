import { PencilLine } from "lucide-react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  AppContextMenuContent,
  AppContextMenuGroup,
  AppContextMenuItem,
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
        <AppContextMenuItem onSelect={props.on_open_edit}>
          <PencilLine />
          {t("text_preserve_page.action.edit")}
        </AppContextMenuItem>
      </AppContextMenuGroup>
    </AppContextMenuContent>
  );
}
