import { useI18n } from "@/i18n";
import { useActionShortcut } from "@/hooks/use-action-shortcut";
import type { NameFieldDialogState, NameFieldRow } from "@/pages/name-field-extraction-page/types";
import { AppButton } from "@/widgets/app-button/app-button";
import { AppEditor } from "@/widgets/app-editor/app-editor";
import { AppPageDialog } from "@/widgets/app-page-dialog/app-page-dialog";
import { ShortcutKbd } from "@/widgets/shortcut-kbd/shortcut-kbd";

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

  useActionShortcut({
    action: "save",
    enabled: props.state.open && !props.state.saving,
    on_trigger: () => {
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
          <AppButton
            type="button"
            variant="outline"
            size="sm"
            disabled={props.state.saving}
            onClick={() => {
              void props.on_close();
            }}
          >
            {t("app.action.cancel")}
          </AppButton>
          <AppButton
            type="button"
            size="sm"
            disabled={props.state.saving}
            onClick={() => {
              void props.on_save();
            }}
          >
            {save_label}
            <ShortcutKbd action="save" className="bg-background/18 text-primary-foreground" />
          </AppButton>
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
