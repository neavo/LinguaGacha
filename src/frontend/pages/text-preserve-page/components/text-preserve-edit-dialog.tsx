import { useI18n } from "@frontend/app/locale/locale-provider";
import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import type {
  TextPreserveDialogMode,
  TextPreserveEntry,
} from "@frontend/pages/text-preserve-page/types";
import { AppButton } from "@frontend/widgets/app-button";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { ShortcutKbd } from "@frontend/widgets/interactions/shortcut-kbd";

type TextPreserveEditDialogProps = {
  open: boolean;
  mode: TextPreserveDialogMode;
  entry: TextPreserveEntry;
  saving: boolean;
  validation_message: string | null;
  on_change: (patch: Partial<TextPreserveEntry>) => void;
  on_save: () => Promise<void>;
  on_close: () => Promise<void>;
};
export function TextPreserveEditDialog(props: TextPreserveEditDialogProps): JSX.Element {
  const { t } = useI18n();
  const save_label = t("text_preserve_page.action.save");
  const title =
    props.mode === "create"
      ? t("text_preserve_page.dialog.create_title")
      : t("text_preserve_page.dialog.edit_title");

  useActionShortcut({
    action: "save",
    enabled: props.open && !props.saving,
    on_trigger: () => {
      void props.on_save();
    },
  });

  return (
    <AppPageDialog
      open={props.open}
      title={title}
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
            disabled={props.saving}
            onClick={() => {
              void props.on_close();
            }}
          >
            {t("text_preserve_page.action.cancel")}
          </AppButton>
          <AppButton
            type="button"
            size="sm"
            disabled={props.saving}
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
      <div className="text-preserve-page__dialog-scroll">
        <div className="text-preserve-page__dialog-form">
          <div className="text-preserve-page__dialog-main-panel">
            <div className="text-preserve-page__dialog-main-panel-content">
              <label className="text-preserve-page__dialog-section">
                <span className="text-preserve-page__dialog-section-title font-medium">
                  {t("text_preserve_page.fields.rule")}
                </span>
                <AppEditor
                  class_name="text-preserve-page__dialog-editor"
                  value={props.entry.src}
                  aria_label={t("text_preserve_page.fields.rule")}
                  read_only={props.saving}
                  invalid={props.validation_message !== null}
                  indent_with_tab={false}
                  on_change={(next_value) => {
                    props.on_change({ src: next_value });
                  }}
                />
                {props.validation_message === null ? null : (
                  <span className="text-preserve-page__dialog-error">
                    {props.validation_message}
                  </span>
                )}
              </label>

              <label className="text-preserve-page__dialog-section">
                <span className="text-preserve-page__dialog-section-title font-medium">
                  {t("text_preserve_page.fields.note")}
                </span>
                <AppEditor
                  class_name="text-preserve-page__dialog-editor"
                  value={props.entry.info}
                  aria_label={t("text_preserve_page.fields.note")}
                  read_only={props.saving}
                  indent_with_tab={false}
                  on_change={(next_value) => {
                    props.on_change({ info: next_value });
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </AppPageDialog>
  );
}
