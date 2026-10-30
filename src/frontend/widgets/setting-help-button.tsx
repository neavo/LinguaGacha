import type { JSX } from "react";
import { BadgeHelp } from "lucide-react";

import { open_external_url } from "@frontend/app/desktop/desktop-api";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";

type SettingHelpButtonProps = {
  url: string;
  label: string;
  className?: string;
};
/** 帮助入口用同一文案提供鼠标提示与辅助名称。 */
export function SettingHelpButton(props: SettingHelpButtonProps): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <AppButton
            type="button"
            variant="ghost"
            size="icon-xs"
            className={props.className}
            aria-label={props.label}
            onClick={() => {
              void open_external_url(props.url);
            }}
          >
            <BadgeHelp />
          </AppButton>
        }
      />
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}
