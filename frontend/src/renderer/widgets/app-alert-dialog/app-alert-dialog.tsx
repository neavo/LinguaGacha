import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shadcn/alert-dialog";
import { Spinner } from "@/shadcn/spinner";

type AppAlertDialogSize = "default" | "sm";

type AppAlertDialogProps = {
  open: boolean;
  title: string;
  description: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  submitting?: boolean;
  size?: AppAlertDialogSize;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?:
    | "default"
    | "destructive"
    | "secondary"
    | "outline"
    | "ghost"
    | "link";
  contentClassName?: string;
  descriptionClassName?: string;
};

type ClosableEvent = {
  preventDefault: () => void;
};

function preventDialogClose(event: ClosableEvent): void {
  event.preventDefault();
}

export function AppAlertDialog(props: AppAlertDialogProps): JSX.Element {
  const { t } = useI18n();
  const submitting = props.submitting ?? false;

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
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription
            className={cn(
              "whitespace-pre-line text-left",
              props.descriptionClassName,
            )}
          >
            {props.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm" disabled={submitting}>
            {props.cancelLabel ?? t("app.action.cancel")}
          </AlertDialogCancel>
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
                <Spinner data-icon="inline-start" />
                {t("app.action.loading")}
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
