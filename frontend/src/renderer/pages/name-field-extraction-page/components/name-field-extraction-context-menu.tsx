import { PencilLine } from "lucide-react";

import { useI18n } from "@/i18n";
import { ContextMenuContent, ContextMenuGroup, ContextMenuItem } from "@/shadcn/context-menu";

type NameFieldExtractionContextMenuContentProps = {
  on_edit: () => void;
};

export function NameFieldExtractionContextMenuContent(
  props: NameFieldExtractionContextMenuContentProps,
): JSX.Element {
  const { t } = useI18n();

  return (
    <ContextMenuContent>
      <ContextMenuGroup>
        <ContextMenuItem onSelect={props.on_edit}>
          <PencilLine />
          {t("name_field_extraction_page.action.edit")}
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  );
}
