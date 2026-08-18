import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import {
  type QualityRuleConfirmKind,
  type QualityRuleConfirmState,
} from "@frontend/features/quality-rule-editor/quality-rule-confirm-state";
import { AppConfirmDialog } from "@frontend/widgets/app-alert-dialog";

type QualityRuleConfirmDialogProps = {
  state: QualityRuleConfirmState;
  on_confirm: () => void;
  on_close: () => void;
};

const CONFIRM_DESCRIPTION_KEY_BY_KIND: Record<QualityRuleConfirmKind, LocaleKey> = {
  "delete-selection": "quality_rule_editor.confirm.delete_selection.description",
  "delete-preset": "preset_editor.confirm.delete.description",
  reset: "quality_rule_editor.confirm.reset.description",
  "overwrite-preset": "preset_editor.confirm.overwrite.description",
};

export function QualityRuleConfirmDialog(props: QualityRuleConfirmDialogProps): JSX.Element {
  const { t } = useI18n();
  const description_key =
    props.state.kind === null ? null : CONFIRM_DESCRIPTION_KEY_BY_KIND[props.state.kind];
  const description =
    description_key === null
      ? ""
      : t(description_key).replace("{COUNT}", props.state.selection_count.toString());

  return (
    <AppConfirmDialog
      open={props.state.open}
      description={description}
      submitting={props.state.submitting}
      onConfirm={props.on_confirm}
      onClose={props.on_close}
    />
  );
}
