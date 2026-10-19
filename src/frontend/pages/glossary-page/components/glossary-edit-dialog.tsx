import type { JSX } from "react";
import { CaseSensitive } from "lucide-react";

import { useI18n } from "@frontend/app/locale/locale-context";
import type { GlossaryDialogMode, GlossaryEntryDraft } from "@frontend/pages/glossary-page/types";
import { BooleanSegmentedToggle } from "@frontend/widgets/boolean-segmented-toggle";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";

type GlossaryEditDialogProps = {
  open: boolean;
  mode: GlossaryDialogMode;
  entry: GlossaryEntryDraft;
  saving: boolean;
  readonly: boolean;
  on_change: (patch: Partial<GlossaryEntryDraft>) => void;
  on_save: () => Promise<void>;
  on_close: () => Promise<void>;
};
/** 组合规则草稿字段，保存与关闭交由页面状态拥有者处理。 */
export function GlossaryEditDialog(props: GlossaryEditDialogProps): JSX.Element {
  const { t } = useI18n();
  const disabled = props.readonly || props.saving; // 编辑与保存共用只读、提交中的锁定条件。
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
        onSelect: props.on_save,
      }}
    >
      <div className="glossary-page__dialog-scroll">
        <div className="glossary-page__dialog-form">
          <div className="glossary-page__dialog-main-panel">
            <div className="glossary-page__dialog-main-panel-content">
              <div className="glossary-page__dialog-section">
                <span className="glossary-page__dialog-section-title font-medium">
                  {t("quality_rule_editor.fields.source")}
                </span>
                <AppEditor
                  class_name="glossary-page__dialog-editor"
                  value={props.entry.src}
                  aria_label={t("quality_rule_editor.fields.source")}
                  read_only={disabled}
                  indent_with_tab={false}
                  on_change={(next_value) => {
                    props.on_change({ src: next_value });
                  }}
                />
              </div>

              <div className="glossary-page__dialog-section">
                <span className="glossary-page__dialog-section-title font-medium">
                  {t("glossary_page.fields.translation")}
                </span>
                <AppEditor
                  class_name="glossary-page__dialog-editor"
                  value={props.entry.dst}
                  aria_label={t("glossary_page.fields.translation")}
                  read_only={disabled}
                  indent_with_tab={false}
                  on_change={(next_value) => {
                    props.on_change({ dst: next_value });
                  }}
                />
              </div>

              <div className="glossary-page__dialog-section glossary-page__dialog-section--description">
                <span className="glossary-page__dialog-section-title font-medium">
                  {t("glossary_page.fields.description")}
                </span>
                <AppEditor
                  class_name="glossary-page__dialog-editor"
                  value={props.entry.info}
                  aria_label={t("glossary_page.fields.description")}
                  read_only={disabled}
                  indent_with_tab={false}
                  on_change={(next_value) => {
                    props.on_change({ info: next_value });
                  }}
                />
              </div>
            </div>
          </div>

          <div className="glossary-page__dialog-rule-grid">
            <div className="glossary-page__dialog-rule-item">
              <div className="glossary-page__dialog-rule-copy">
                <span className="glossary-page__rule-badge-wrap" aria-hidden="true">
                  <span
                    data-state="inactive"
                    className="glossary-page__rule-badge glossary-page__dialog-rule-badge"
                  >
                    <CaseSensitive />
                  </span>
                </span>
                <span className="glossary-page__dialog-rule-title font-medium">
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
            </div>
          </div>
        </div>
      </div>
    </AppPageDialog>
  );
}
