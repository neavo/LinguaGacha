import { FileDown, Fingerprint, ScanText, Trash2 } from "lucide-react";

import { useActionShortcut } from "@/hooks/use-action-shortcut";
import { useI18n } from "@/i18n";
import type { NameFieldRunState } from "@/pages/name-field-extraction-page/types";
import { Badge } from "@/shadcn/badge";
import { Button } from "@/shadcn/button";
import { Spinner } from "@/shadcn/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shadcn/tooltip";
import {
  CommandBar,
  CommandBarGroup,
  CommandBarSeparator,
} from "@/widgets/command-bar/command-bar";
import { ShortcutKbd } from "@/widgets/shortcut-kbd/shortcut-kbd";

type NameFieldExtractionCommandBarProps = {
  row_count: number;
  pending_count: number;
  selected_count: number;
  run_state: NameFieldRunState;
  is_running: boolean;
  on_extract: () => Promise<void>;
  on_translate: () => Promise<void>;
  on_delete: () => void;
  on_import: () => Promise<void>;
};

export function NameFieldExtractionCommandBar(
  props: NameFieldExtractionCommandBarProps,
): JSX.Element {
  const { t } = useI18n();
  const detail_tooltip_text = `${t("name_field_extraction_page.summary.description")} ${t("name_field_extraction_page.summary.emphasis")}`;
  const delete_disabled = props.selected_count === 0 || props.is_running;

  useActionShortcut({
    action: "delete",
    enabled: !delete_disabled,
    on_trigger: props.on_delete,
  });

  return (
    <CommandBar
      className="name-field-extraction-page__command-bar"
      title={t("name_field_extraction_page.title")}
      actions={
        <>
          <CommandBarGroup>
            <Button
              variant="ghost"
              size="toolbar"
              disabled={props.is_running}
              onClick={() => {
                void props.on_extract();
              }}
            >
              {props.run_state.extracting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Fingerprint data-icon="inline-start" />
              )}
              {props.run_state.extracting
                ? t("name_field_extraction_page.action.extracting")
                : t("name_field_extraction_page.action.extract")}
            </Button>
            <Button
              variant="ghost"
              size="toolbar"
              disabled={props.pending_count === 0 || props.is_running}
              onClick={() => {
                void props.on_translate();
              }}
            >
              {props.run_state.translating ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <ScanText data-icon="inline-start" />
              )}
              {props.run_state.translating
                ? t("name_field_extraction_page.action.translating")
                : t("name_field_extraction_page.action.translate")}
            </Button>
          </CommandBarGroup>
          <CommandBarSeparator />
          <CommandBarGroup>
            <Button
              variant="ghost"
              size="toolbar"
              disabled={delete_disabled}
              onClick={props.on_delete}
            >
              <Trash2 data-icon="inline-start" />
              {t("name_field_extraction_page.action.delete")}
              <ShortcutKbd action="delete" />
            </Button>
          </CommandBarGroup>
          <CommandBarSeparator />
          <CommandBarGroup>
            <Button
              variant="ghost"
              size="toolbar"
              disabled={props.row_count === 0 || props.is_running}
              onClick={() => {
                void props.on_import();
              }}
            >
              <FileDown data-icon="inline-start" />
              {t("name_field_extraction_page.action.import_glossary")}
            </Button>
          </CommandBarGroup>
        </>
      }
      hint={
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="name-field-extraction-page__summary-trigger" type="button">
              <Badge
                className="name-field-extraction-page__summary name-field-extraction-page__summary-badge name-field-extraction-page__summary-badge--clickable name-field-extraction-page__summary-badge--neutral"
                variant="outline"
              >
                {t("name_field_extraction_page.title")}
              </Badge>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            <p>{detail_tooltip_text}</p>
          </TooltipContent>
        </Tooltip>
      }
    />
  );
}
