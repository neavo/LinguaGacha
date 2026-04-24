import { useI18n } from "@/i18n";
import { useSaveShortcut } from "@/hooks/use-save-shortcut";
import type { NameFieldDialogState, NameFieldRow } from "@/pages/name-field-extraction-page/types";
import { Button } from "@/shadcn/button";
import { Kbd } from "@/shadcn/kbd";
import { AppEditor } from "@/widgets/app-editor/app-editor";
import { AppPageDialog } from "@/widgets/app-page-dialog/app-page-dialog";

type NameFieldExtractionEditDialogProps = {
  state: NameFieldDialogState;
  on_change: (patch: Partial<NameFieldRow>) => void;
  on_save: () => Promise<void>;
  on_close: () => Promise<void>;
};

export function NameFieldExtractionEditDialog(
  props: NameFieldExtractionEditDialogProps,
): JSX.Element {
  const { t } = useI18n();
  const save_label = t("name_field_extraction_page.action.save");

  useSaveShortcut({
    enabled: props.state.open && !props.state.saving,
    on_save: () => {
      void props.on_save();
    },
  });

  return (
    <AppPageDialog
      open={props.state.open}
      title={t("name_field_extraction_page.dialog.edit_title")}
      size="lg"
      dismissBehavior="blocked"
      onClose={props.on_close}
      bodyClassName="overflow-hidden p-0"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.state.saving}
            onClick={() => {
              void props.on_close();
            }}
          >
            {t("app.action.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={props.state.saving}
            onClick={() => {
              void props.on_save();
            }}
          >
            {save_label}
            <Kbd className="bg-background/18 text-primary-foreground">Ctrl+S</Kbd>
          </Button>
        </>
      }
    >
      <div className="name-field-extraction-page__dialog-scroll">
        <div className="name-field-extraction-page__dialog-form">
          <div className="name-field-extraction-page__dialog-main-panel">
            <div className="name-field-extraction-page__dialog-main-panel-content">
              <label className="name-field-extraction-page__dialog-section">
                <span className="name-field-extraction-page__dialog-section-title font-medium">
                  {t("name_field_extraction_page.fields.source")}
                </span>
                <AppEditor
                  class_name="name-field-extraction-page__dialog-editor"
                  value={props.state.draft_row.src}
                  aria_label={t("name_field_extraction_page.fields.source")}
                  read_only
                />
              </label>

              <label className="name-field-extraction-page__dialog-section">
                <span className="name-field-extraction-page__dialog-section-title font-medium">
                  {t("name_field_extraction_page.fields.translation")}
                </span>
                <AppEditor
                  class_name="name-field-extraction-page__dialog-editor"
                  value={props.state.draft_row.dst}
                  aria_label={t("name_field_extraction_page.fields.translation")}
                  read_only={props.state.saving}
                  on_change={(next_value) => {
                    props.on_change({ dst: next_value });
                  }}
                />
              </label>

              <label className="name-field-extraction-page__dialog-section name-field-extraction-page__dialog-section--context">
                <span className="name-field-extraction-page__dialog-section-title font-medium">
                  {t("name_field_extraction_page.fields.context")}
                </span>
                <AppEditor
                  class_name="name-field-extraction-page__dialog-editor"
                  value={props.state.draft_row.context}
                  aria_label={t("name_field_extraction_page.fields.context")}
                  read_only
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </AppPageDialog>
  );
}
