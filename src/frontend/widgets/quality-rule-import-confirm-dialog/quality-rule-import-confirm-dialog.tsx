import { useI18n } from "@frontend/app/locale/locale-provider";
import type { QualityRuleImportConfirmState } from "@frontend/widgets/quality-rule-import-confirm-dialog/quality-rule-import-confirm-state";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";

type QualityRuleImportConfirmDialogProps = {
  state: QualityRuleImportConfirmState;
  on_skip: () => void | Promise<void>;
  on_overwrite: () => void | Promise<void>;
  on_close: () => void;
};
export function QualityRuleImportConfirmDialog(
  props: QualityRuleImportConfirmDialogProps,
): JSX.Element {
  const { t } = useI18n();
  // 文案和按钮顺序固定在共享组件里，避免各页面形成第二套导入确认口径
  const description = t("app.quality_rule_import.duplicate_description").replace(
    "{COUNT}",
    props.state.duplicate_count.toString(),
  );

  return (
    <AppActionDialog
      open={props.state.open}
      description={description}
      submitting={props.state.submitting}
      primaryAction={{
        label: t("app.action.overwrite"),
        onSelect: props.on_overwrite,
        destructive: true,
      }}
      secondaryAction={{ label: t("app.action.skip"), onSelect: props.on_skip }}
      onClose={props.on_close}
    />
  );
}
