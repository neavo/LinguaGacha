import { PencilLine } from "lucide-react";

import { useI18n } from "@/i18n";
import {
  AppContextMenuContent,
  AppContextMenuGroup,
  AppContextMenuItem,
} from "@/widgets/app-context-menu/app-context-menu";

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
