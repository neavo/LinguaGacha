import type { WorkbenchTaskConfirmDialogViewModel } from "@/pages/workbench-page/types";
import { AppAlertDialog } from "@/widgets/app-alert-dialog/app-alert-dialog";

type TaskRuntimeConfirmDialogProps = {
  view_model: WorkbenchTaskConfirmDialogViewModel | null;
  on_confirm: () => Promise<void>;
  on_close: () => void;
};

export function TaskRuntimeConfirmDialog(
  props: TaskRuntimeConfirmDialogProps,
): JSX.Element {
  return (
    <AppAlertDialog
      open={props.view_model?.open ?? false}
      title={props.view_model?.title ?? ""}
      description={props.view_model?.description ?? ""}
      submitting={props.view_model?.submitting ?? false}
      onConfirm={props.on_confirm}
      onClose={props.on_close}
    />
  );
}
