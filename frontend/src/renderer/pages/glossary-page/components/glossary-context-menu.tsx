import { CaseSensitive, PencilLine } from "lucide-react";

import { useI18n } from "@/i18n";
import {
  AppContextMenuContent,
  AppContextMenuGroup,
  AppContextMenuItem,
  AppContextMenuRadioGroup,
  AppContextMenuRadioItem,
  AppContextMenuSub,
  AppContextMenuSubContent,
  AppContextMenuSubTrigger,
} from "@/widgets/app-context-menu/app-context-menu";

type GlossaryContextMenuContentProps = {
  case_sensitive_state: "enabled" | "disabled" | "mixed";
  on_open_edit: () => void;
  on_toggle_case_sensitive: (next_value: boolean) => Promise<void>;
};

export function GlossaryContextMenuContent(props: GlossaryContextMenuContentProps): JSX.Element {
  const { t } = useI18n();

  return (
    <AppContextMenuContent>
      <AppContextMenuGroup>
        <AppContextMenuItem
          onSelect={() => {
            props.on_open_edit();
          }}
        >
          <PencilLine />
          {t("glossary_page.action.edit")}
        </AppContextMenuItem>
        <AppContextMenuSub>
          <AppContextMenuSubTrigger>
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
                {t("app.toggle.enabled")}
              </AppContextMenuRadioItem>
              <AppContextMenuRadioItem value="disabled">
                {t("app.toggle.disabled")}
              </AppContextMenuRadioItem>
            </AppContextMenuRadioGroup>
          </AppContextMenuSubContent>
        </AppContextMenuSub>
      </AppContextMenuGroup>
    </AppContextMenuContent>
  );
}
