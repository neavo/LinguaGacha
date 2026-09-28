import type { JSX } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import type { QualityRuleDuplicateConfirmState } from "@frontend/features/quality-rule-editor/use-quality-rule-duplicate-confirmation";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";

type QualityRuleDuplicateConfirmDialogProps = {
  state: QualityRuleDuplicateConfirmState;
  on_skip: () => void | Promise<void>;
  on_overwrite: () => void | Promise<void>;
  on_close: () => void;
};
/** 单条编辑提供覆盖与取消，批量导入额外提供跳过。 */
export function QualityRuleDuplicateConfirmDialog(
  props: QualityRuleDuplicateConfirmDialogProps,
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
      {...(!props.state.allow_skip
        ? {}
        : { secondaryAction: { label: t("app.action.skip"), onSelect: props.on_skip } })}
      onClose={props.on_close}
    />
  );
}
