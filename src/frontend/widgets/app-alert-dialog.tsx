import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { useI18n } from "@frontend/app/locale/locale-provider";
import { cn } from "@frontend/shadcn/classnames";
import { Button } from "@frontend/shadcn/button";
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
 * 应用级确认框：统一提交态的关闭互斥、默认文案与危险操作样式。
 */
export function AppAlertDialog(props: AppAlertDialogProps): JSX.Element {
  const { t } = useI18n();
  const submitting = props.submitting ?? false;
  const submitting_icon = props.submittingIcon ?? true;
  const title = props.title ?? t("app.action.confirm");
  const size = props.size ?? "default";

  return (
    <AlertDialogPrimitive.Root
      data-slot="alert-dialog"
      open={props.open}
      onOpenChange={(next_open) => {
        if (!next_open && !submitting) {
          props.onClose();
        }
      }}
    >
      <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal">
        <AlertDialogPrimitive.Overlay
          data-slot="alert-dialog-overlay"
          className="fixed inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <AlertDialogPrimitive.Content
          data-slot="alert-dialog-content"
          data-size={size}
          className={cn(
            "group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            props.contentClassName,
          )}
          onEscapeKeyDown={submitting ? preventDialogClose : undefined}
        >
          <div
            data-slot="alert-dialog-header"
            className="grid grid-rows-[auto_1fr] place-items-start gap-1.5 text-left has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-4 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]"
          >
            <AlertDialogPrimitive.Title
              data-slot="alert-dialog-title"
              className="font-heading text-base font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2"
            >
              {title}
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description
              data-slot="alert-dialog-description"
              className={cn(
                "text-sm text-balance whitespace-pre-line text-left text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
                props.descriptionClassName,
              )}
            >
              {props.description}
            </AlertDialogPrimitive.Description>
          </div>
          <div
            data-slot="alert-dialog-footer"
            className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end"
          >
            <Button variant="outline" size="sm" asChild>
              <AlertDialogPrimitive.Cancel
                data-slot="alert-dialog-cancel"
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
              </AlertDialogPrimitive.Cancel>
            </Button>
            {props.onSecondary !== undefined ? (
              <Button variant="outline" size="sm" asChild>
                <AlertDialogPrimitive.Action
                  data-slot="alert-dialog-action"
                  disabled={submitting}
                  onClick={(event) => {
                    event.preventDefault();
                    void props.onSecondary?.();
                  }}
                >
                  {props.secondaryLabel ?? t("app.action.confirm")}
                </AlertDialogPrimitive.Action>
              </Button>
            ) : null}
            <Button variant={props.confirmVariant ?? "default"} size="sm" asChild>
              <AlertDialogPrimitive.Action
                data-slot="alert-dialog-action"
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
              </AlertDialogPrimitive.Action>
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
