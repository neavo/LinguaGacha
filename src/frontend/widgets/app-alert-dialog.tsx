import { useI18n } from "@frontend/app/locale/locale-provider";
import { cn } from "@frontend/styling/classnames";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@frontend/shadcn/alert-dialog";
import { Spinner } from "@frontend/shadcn/spinner";

type AppAlertDialogSize = "default" | "sm";

type AppAlertDialogProps = {
  open: boolean;
  title?: string;
  description: string;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  onClose: () => void;
  submitting?: boolean;
  size?: AppAlertDialogSize;
  confirmLabel?: string;
  submittingLabel?: string;
  submittingIcon?: boolean;
  cancelLabel?: string;
  secondaryLabel?: string;
  onSecondary?: () => void | Promise<void>;
  confirmVariant?: "default" | "destructive" | "secondary" | "outline" | "ghost" | "link";
  contentClassName?: string;
  descriptionClassName?: string;
};

type ClosableEvent = {
  preventDefault: () => void;
};

/**
 * 阻止 Radix 在提交中通过键盘或外部事件关闭确认框。
 */
function preventDialogClose(event: ClosableEvent): void {
  event.preventDefault();
}

/**
 * 渲染应用统一确认框，集中处理提交态、次要动作和文案兜底。
 */
export function AppAlertDialog(props: AppAlertDialogProps): JSX.Element {
  const { t } = useI18n();
  const submitting = props.submitting ?? false;
  const submitting_icon = props.submittingIcon ?? true;
  const title = props.title ?? t("app.action.confirm");

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(next_open) => {
        if (!next_open && !submitting) {
          props.onClose();
        }
      }}
    >
      <AlertDialogContent
        size={props.size ?? "default"}
        className={props.contentClassName}
        onEscapeKeyDown={submitting ? preventDialogClose : undefined}
      >
        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription
            className={cn("whitespace-pre-line text-left", props.descriptionClassName)}
          >
            {props.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            size="sm"
            disabled={submitting}
            onClick={(event) => {
              if (props.onCancel === undefined) {
                return;
              }
              event.preventDefault();
              void props.onCancel();
            }}
          >
            {props.cancelLabel ?? t("app.action.cancel")}
          </AlertDialogCancel>
          {props.onSecondary !== undefined ? (
            <AlertDialogAction
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={(event) => {
                event.preventDefault();
                void props.onSecondary?.();
              }}
            >
              {props.secondaryLabel ?? t("app.action.confirm")}
            </AlertDialogAction>
          ) : null}
          <AlertDialogAction
            size="sm"
            variant={props.confirmVariant ?? "default"}
            disabled={submitting}
            onClick={(event) => {
              event.preventDefault();
              void props.onConfirm();
            }}
          >
            {submitting ? (
              <>
                {submitting_icon ? <Spinner data-icon="inline-start" /> : null}
                {props.submittingLabel ?? t("app.action.loading")}
              </>
            ) : (
              (props.confirmLabel ?? t("app.action.confirm"))
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
