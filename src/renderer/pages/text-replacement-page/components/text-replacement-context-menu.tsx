import { CaseSensitive, PencilLine, Regex } from "lucide-react";

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

type TextReplacementContextMenuContentProps = {
  regex_state: "enabled" | "disabled" | "mixed";
  case_sensitive_state: "enabled" | "disabled" | "mixed";
  on_open_edit: () => void;
  on_toggle_regex: (next_value: boolean) => Promise<void>;
  on_toggle_case_sensitive: (next_value: boolean) => Promise<void>;
};

export function TextReplacementContextMenuContent(
  props: TextReplacementContextMenuContentProps,
): JSX.Element {
  const { t } = useI18n();

  return (
    <AppContextMenuContent>
      <AppContextMenuGroup>
        <AppContextMenuItem onSelect={props.on_open_edit}>
          <PencilLine />
          {t("text_replacement_page.action.edit")}
        </AppContextMenuItem>
        <AppContextMenuSub>
          <AppContextMenuSubTrigger>
            <Regex />
            {t("text_replacement_page.rule.regex")}
          </AppContextMenuSubTrigger>
          <AppContextMenuSubContent>
            <AppContextMenuRadioGroup
              value={props.regex_state}
              onValueChange={(next_value) => {
                if (next_value === "enabled") {
                  void props.on_toggle_regex(true);
                } else if (next_value === "disabled") {
                  void props.on_toggle_regex(false);
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
        <AppContextMenuSub>
          <AppContextMenuSubTrigger>
            <CaseSensitive />
            {t("text_replacement_page.rule.case_sensitive")}
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
