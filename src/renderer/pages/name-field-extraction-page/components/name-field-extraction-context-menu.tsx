import { PencilLine } from "lucide-react";

import { useI18n } from "@/app/locale/locale-provider";
import {
  AppContextMenuContent,
  AppContextMenuGroup,
  AppContextMenuItem,
} from "@/widgets/app-context-menu";

type NameFieldExtractionContextMenuContentProps = {
  on_edit: () => void;
};
export function NameFieldExtractionContextMenuContent(
  props: NameFieldExtractionContextMenuContentProps,
): JSX.Element {
  const { t } = useI18n();

  return (
    <AppContextMenuContent>
      <AppContextMenuGroup>
        <AppContextMenuItem onSelect={props.on_edit}>
          <PencilLine />
          {t("name_field_extraction_page.action.edit")}
        </AppContextMenuItem>
      </AppContextMenuGroup>
    </AppContextMenuContent>
  );
}
