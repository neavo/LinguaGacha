import { CaseSensitive, Regex } from "lucide-react";

import { useI18n } from "@/i18n";
import { useActionShortcut } from "@/hooks/use-action-shortcut";
import type {
  TextReplacementDialogMode,
  TextReplacementEntry,
} from "@/pages/text-replacement-page/types";
import { AppButton } from "@/widgets/app-button/app-button";
import { AppEditor } from "@/widgets/app-editor/app-editor";
import { AppPageDialog } from "@/widgets/app-page-dialog/app-page-dialog";
import { SegmentedToggle } from "@/widgets/segmented-toggle/segmented-toggle";
import { ShortcutKbd } from "@/widgets/shortcut-kbd/shortcut-kbd";

type TextReplacementEditDialogProps = {
  open: boolean;
  mode: TextReplacementDialogMode;
  entry: TextReplacementEntry;
  saving: boolean;
  validation_message: string | null;
  on_change: (patch: Partial<TextReplacementEntry>) => void;
  on_save: () => Promise<void>;
  on_close: () => Promise<void>;
};

export function TextReplacementEditDialog(props: TextReplacementEditDialogProps): JSX.Element {
  const { t } = useI18n();
  const save_label = t("text_replacement_page.action.save");
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
  const title =
    props.mode === "create"
      ? t("text_replacement_page.dialog.create_title")
      : t("text_replacement_page.dialog.edit_title");

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
            {t("text_replacement_page.action.cancel")}
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
      <div className="text-replacement-page__dialog-scroll">
        <div className="text-replacement-page__dialog-form">
          <div className="text-replacement-page__dialog-main-panel">
            <div className="text-replacement-page__dialog-main-panel-content">
              <label className="text-replacement-page__dialog-section">
                <span className="text-replacement-page__dialog-section-title font-medium">
                  {t("text_replacement_page.fields.source")}
                </span>
                <AppEditor
                  class_name="text-replacement-page__dialog-editor"
                  value={props.entry.src}
                  aria_label={t("text_replacement_page.fields.source")}
                  read_only={props.saving}
                  invalid={props.validation_message !== null}
                  on_change={(next_value) => {
                    props.on_change({ src: next_value });
                  }}
                />
                {props.validation_message === null ? null : (
                  <span className="text-replacement-page__dialog-error">
                    {props.validation_message}
                  </span>
                )}
              </label>

              <label className="text-replacement-page__dialog-section">
                <span className="text-replacement-page__dialog-section-title font-medium">
                  {t("text_replacement_page.fields.replacement")}
                </span>
                <AppEditor
                  class_name="text-replacement-page__dialog-editor"
                  value={props.entry.dst}
                  aria_label={t("text_replacement_page.fields.replacement")}
                  read_only={props.saving}
                  on_change={(next_value) => {
                    props.on_change({ dst: next_value });
                  }}
                />
              </label>
            </div>
          </div>

          <div className="text-replacement-page__dialog-rule-grid">
            <div className="text-replacement-page__dialog-rule-item">
              <div className="text-replacement-page__dialog-rule-copy">
                <span className="text-replacement-page__rule-badge-wrap" aria-hidden="true">
                  <span
                    data-state={props.entry.regex ? "active" : "inactive"}
                    className="text-replacement-page__rule-badge text-replacement-page__dialog-rule-badge"
                  >
                    <Regex />
                  </span>
                </span>
                <span className="text-replacement-page__dialog-rule-title font-medium">
                  {t("text_replacement_page.rule.regex")}
                </span>
              </div>
              <SegmentedToggle
                aria_label={t("text_replacement_page.rule.regex")}
                value={props.entry.regex ? "enabled" : "disabled"}
                options={boolean_segmented_options}
                disabled={props.saving}
                size="sm"
                on_value_change={(next_value) => {
                  props.on_change({
                    regex: next_value === "enabled",
                  });
                }}
              />
            </div>

            <div className="text-replacement-page__dialog-rule-item">
              <div className="text-replacement-page__dialog-rule-copy">
                <span className="text-replacement-page__rule-badge-wrap" aria-hidden="true">
                  <span
                    data-state={props.entry.case_sensitive ? "active" : "inactive"}
                    className="text-replacement-page__rule-badge text-replacement-page__dialog-rule-badge"
                  >
                    <CaseSensitive />
                  </span>
                </span>
                <span className="text-replacement-page__dialog-rule-title font-medium">
                  {t("text_replacement_page.rule.case_sensitive")}
                </span>
              </div>
              <SegmentedToggle
                aria_label={t("text_replacement_page.rule.case_sensitive")}
                value={props.entry.case_sensitive ? "enabled" : "disabled"}
                options={boolean_segmented_options}
                disabled={props.saving}
                size="sm"
                on_value_change={(next_value) => {
                  props.on_change({
                    case_sensitive: next_value === "enabled",
                  });
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </AppPageDialog>
  );
}
