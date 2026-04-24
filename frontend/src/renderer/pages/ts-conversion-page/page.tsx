import { Play } from "lucide-react";

import type { ScreenComponentProps } from "@/app/navigation/types";
import { useI18n, type LocaleKey } from "@/i18n";
import "@/pages/ts-conversion-page/ts-conversion-page.css";
import type { TsConversionDirection } from "@/pages/ts-conversion-page/types";
import { useTsConversionPageState } from "@/pages/ts-conversion-page/use-ts-conversion-page-state";
import { Badge } from "@/shadcn/badge";
import { Button } from "@/shadcn/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shadcn/select";
import { Spinner } from "@/shadcn/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shadcn/tooltip";
import { AppAlertDialog } from "@/widgets/app-alert-dialog/app-alert-dialog";
import { CommandBar, CommandBarGroup } from "@/widgets/command-bar/command-bar";
import { SegmentedToggle } from "@/widgets/segmented-toggle/segmented-toggle";
import { SettingCardRow } from "@/widgets/setting-card-row/setting-card-row";

const DIRECTION_OPTIONS: TsConversionDirection[] = ["t2s", "s2t"];
const DIRECTION_LABEL_KEY_BY_DIRECTION = {
  t2s: "ts_conversion_page.direction.t2s",
  s2t: "ts_conversion_page.direction.s2t",
} satisfies Record<TsConversionDirection, LocaleKey>;

export function TsConversionPage(props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const page_state = useTsConversionPageState();
  const boolean_segmented_options = [
    {
      value: "disabled",
      label: t("app.toggle.disabled"),
    },
    {
      value: "enabled",
      label: t("app.toggle.enabled"),
    },
  ] as const;

  return (
    <div
      className="ts-conversion-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      <section className="ts-conversion-page__list" aria-label={t("ts_conversion_page.title")}>
        <SettingCardRow
          title={t("ts_conversion_page.fields.direction.title")}
          description={t("ts_conversion_page.fields.direction.description")}
          action={
            <Select
              value={page_state.direction}
              disabled={page_state.is_running}
              onValueChange={(next_value) => {
                page_state.set_direction(next_value as TsConversionDirection);
              }}
            >
              <SelectTrigger className="ts-conversion-page__select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {DIRECTION_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(DIRECTION_LABEL_KEY_BY_DIRECTION[option])}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          }
        />

        <SettingCardRow
          title={t("ts_conversion_page.fields.preserve_text.title")}
          description={t("ts_conversion_page.fields.preserve_text.description")}
          action={
            <SegmentedToggle
              aria_label={t("ts_conversion_page.fields.preserve_text.title")}
              size="sm"
              value={page_state.preserve_text ? "enabled" : "disabled"}
              options={boolean_segmented_options}
              stretch
              disabled={page_state.is_running}
              on_value_change={(next_value) => {
                page_state.set_preserve_text(next_value === "enabled");
              }}
            />
          }
        />

        <SettingCardRow
          title={t("ts_conversion_page.fields.target_name.title")}
          description={t("ts_conversion_page.fields.target_name.description")}
          action={
            <SegmentedToggle
              aria_label={t("ts_conversion_page.fields.target_name.title")}
              size="sm"
              value={page_state.convert_name ? "enabled" : "disabled"}
              options={boolean_segmented_options}
              stretch
              disabled={page_state.is_running}
              on_value_change={(next_value) => {
                page_state.set_convert_name(next_value === "enabled");
              }}
            />
          }
        />
      </section>

      <CommandBar
        className="ts-conversion-page__command-bar"
        title={t("ts_conversion_page.title")}
        description={t("ts_conversion_page.description")}
        actions={
          <CommandBarGroup>
            <Button
              variant="ghost"
              size="toolbar"
              disabled={page_state.is_running}
              onClick={page_state.request_conversion}
            >
              {page_state.is_running ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              {t("ts_conversion_page.action.start")}
            </Button>
          </CommandBarGroup>
        }
        hint={
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="ts-conversion-page__summary-trigger" type="button">
                <Badge
                  className="ts-conversion-page__summary-badge ts-conversion-page__summary-badge--neutral"
                  variant="outline"
                >
                  {t("ts_conversion_page.title")}
                </Badge>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              <p>{t("ts_conversion_page.description")}</p>
            </TooltipContent>
          </Tooltip>
        }
      />

      <AppAlertDialog
        open={page_state.confirm_state.open}
        description={t("ts_conversion_page.confirm.description")}
        submitting={page_state.confirm_state.submitting}
        onConfirm={page_state.confirm_conversion}
        onClose={page_state.close_confirm_dialog}
      />
    </div>
  );
}
