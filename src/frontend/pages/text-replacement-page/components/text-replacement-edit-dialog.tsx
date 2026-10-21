import { type JSX, useEffect, useRef } from "react";
import { CaseSensitive, Regex } from "lucide-react";

import { useI18n } from "@frontend/app/locale/locale-context";
import { Card } from "@frontend/shadcn/card";
import type {
  TextReplacementDialogMode,
  TextReplacementEntryDraft,
} from "@frontend/pages/text-replacement-page/types";
import { BooleanSegmentedToggle } from "@frontend/widgets/boolean-segmented-toggle";
import { AppEditor, type AppEditorHandle } from "@frontend/widgets/app-editor/app-editor";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";

type TextReplacementEditDialogProps = {
  open: boolean;
  mode: TextReplacementDialogMode;
  entry: TextReplacementEntryDraft;
  saving: boolean;
  readonly: boolean;
  invalid: boolean;
  on_change: (patch: Partial<TextReplacementEntryDraft>) => void;
  on_save: () => Promise<void>;
  on_close: () => Promise<void>;
};
/** 组合替换规则字段、匹配选项与校验定位。 */
export function TextReplacementEditDialog(props: TextReplacementEditDialogProps): JSX.Element {
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
      <div className="text-replacement-page__dialog-scroll">
        <div className="text-replacement-page__dialog-form">
          <Card
            variant="group"
            render={<div />}
            className="text-replacement-page__dialog-main-panel"
          >
            <div className="text-replacement-page__dialog-main-panel-content">
              <div className="text-replacement-page__dialog-section">
                <span className="text-replacement-page__dialog-section-title font-medium">
                  {t("quality_rule_editor.fields.source")}
                </span>
                <AppEditor
                  ref={editor_ref}
                  class_name="text-replacement-page__dialog-editor"
                  value={props.entry.src}
                  aria_label={t("quality_rule_editor.fields.source")}
                  read_only={disabled}
                  invalid={props.invalid}
                  indent_with_tab={false}
                  on_change={(next_value) => {
                    props.on_change({ src: next_value });
                  }}
                />
              </div>

              <div className="text-replacement-page__dialog-section">
                <span className="text-replacement-page__dialog-section-title font-medium">
                  {t("text_replacement_page.fields.replacement")}
                </span>
                <AppEditor
                  class_name="text-replacement-page__dialog-editor"
                  value={props.entry.dst}
                  aria_label={t("text_replacement_page.fields.replacement")}
                  read_only={disabled}
                  indent_with_tab={false}
                  on_change={(next_value) => {
                    props.on_change({ dst: next_value });
                  }}
                />
              </div>
            </div>
          </Card>

          <div className="text-replacement-page__dialog-rule-grid">
            <Card
              variant="group"
              render={<div />}
              className="text-replacement-page__dialog-rule-item"
            >
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
              <BooleanSegmentedToggle
                aria_label={t("text_replacement_page.rule.regex")}
                value={props.entry.regex}
                disabled={disabled}
                on_value_change={(next_value) => {
                  props.on_change({
                    regex: next_value,
                  });
                }}
              />
            </Card>

            <Card
              variant="group"
              render={<div />}
              className="text-replacement-page__dialog-rule-item"
            >
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
                  {t("quality_rule_editor.rule.case_sensitive")}
                </span>
              </div>
              <BooleanSegmentedToggle
                aria_label={t("quality_rule_editor.rule.case_sensitive")}
                value={props.entry.case_sensitive}
                disabled={disabled}
                on_value_change={(next_value) => {
                  props.on_change({
                    case_sensitive: next_value,
                  });
                }}
              />
            </Card>
          </div>
        </div>
      </div>
    </AppPageDialog>
  );
}
