import { type JSX, useEffect, useRef } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { Card } from "@frontend/shadcn/card";
import type {
  TextPreserveDialogMode,
  TextPreserveEntryDraft,
} from "@frontend/pages/text-preserve-page/types";
import { AppEditor, type AppEditorHandle } from "@frontend/widgets/app-editor/app-editor";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";

type TextPreserveEditDialogProps = {
  open: boolean;
  mode: TextPreserveDialogMode;
  entry: TextPreserveEntryDraft;
  saving: boolean;
  readonly: boolean;
  invalid: boolean;
  on_change: (patch: Partial<TextPreserveEntryDraft>) => void;
  on_save: () => Promise<void>;
  on_close: () => Promise<void>;
};
/** 组合保护规则字段、校验定位与保存操作。 */
export function TextPreserveEditDialog(props: TextPreserveEditDialogProps): JSX.Element {
  const { t } = useI18n();
  const editor_ref = useRef<AppEditorHandle>(null);
  useEffect(() => {
    if (props.open && props.invalid && !props.readonly) editor_ref.current?.focus();
  }, [props.open, props.invalid, props.readonly]);
  const disabled = props.readonly || props.saving;
  const title = props.mode === "create" ? t("app.action.create") : t("app.action.edit");

  return (
    <AppPageDialog
      open={props.open}
      title={title}
      size="viewport"
      dismissBehavior="escape-only"
      submitting={props.saving}
      onClose={props.on_close}
      bodyClassName="overflow-hidden p-0"
      primaryAction={{
        label: t("app.action.save"),
        shortcut: "save",
        disabled: props.readonly,
        onSelect: () => {
          if (props.invalid) editor_ref.current?.focus();
          return props.on_save();
        },
      }}
    >
      <div className="text-preserve-page__dialog-scroll">
        <div className="text-preserve-page__dialog-form">
          <Card variant="group" render={<div />} className="text-preserve-page__dialog-main-panel">
            <div className="text-preserve-page__dialog-main-panel-content">
              <div className="text-preserve-page__dialog-section">
                <span className="text-preserve-page__dialog-section-title font-medium">
                  {t("quality_rule_editor.fields.rule")}
                </span>
                <AppEditor
                  ref={editor_ref}
                  class_name="text-preserve-page__dialog-editor"
                  value={props.entry.src}
                  aria_label={t("quality_rule_editor.fields.rule")}
                  read_only={disabled}
                  invalid={props.invalid}
                  indent_with_tab={false}
                  on_change={(next_value) => {
                    props.on_change({ src: next_value });
                  }}
                />
              </div>

              <div className="text-preserve-page__dialog-section">
                <span className="text-preserve-page__dialog-section-title font-medium">
                  {t("text_preserve_page.fields.note")}
                </span>
                <AppEditor
                  class_name="text-preserve-page__dialog-editor"
                  value={props.entry.info}
                  aria_label={t("text_preserve_page.fields.note")}
                  read_only={disabled}
                  indent_with_tab={false}
                  on_change={(next_value) => {
                    props.on_change({ info: next_value });
                  }}
                />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </AppPageDialog>
  );
}
