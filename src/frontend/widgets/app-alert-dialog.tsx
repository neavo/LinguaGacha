import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { useI18n } from "@frontend/app/locale/locale-provider";
import { Button } from "@frontend/shadcn/button";
import { Spinner } from "@frontend/shadcn/spinner";

type AppDialogAction = {
  label: string;
  onSelect: () => void | Promise<void>;
  variant?: "default" | "destructive" | "outline";
};

type AppDialogDismissAction = {
  label: string;
  onSelect?: () => void | Promise<void>;
};

type AppDialogBaseProps = {
  open: boolean;
  title?: string;
  description: string;
  onClose: () => void;
  submitting?: boolean;
  submittingLabel?: string;
  submittingIcon?: boolean;
};

type AppConfirmDialogProps = Omit<AppDialogBaseProps, "submittingLabel" | "submittingIcon"> & {
  onConfirm: () => void | Promise<void>;
};

type AppActionDialogProps = AppDialogBaseProps & {
  primaryAction: AppDialogAction;
  secondaryAction?: AppDialogAction;
  dismissAction?: AppDialogDismissAction | null;
};

type ClosableEvent = {
  preventDefault: () => void;
};

/** 提交期间禁止通过键盘或外部事件关闭模态窗。 */
function preventDialogClose(event: ClosableEvent): void {
  event.preventDefault();
}

/** 固定承载取消/确认语义，调用方不能改写动作文案或主题色。 */
export function AppConfirmDialog(props: AppConfirmDialogProps): JSX.Element {
  const { t } = useI18n();
  return (
    <AppDialog
      open={props.open}
      title={props.title}
      description={props.description}
      submitting={props.submitting}
      primaryAction={{
        label: t("app.action.confirm"),
        onSelect: props.onConfirm,
      }}
      dismissAction={{ label: t("app.action.cancel") }}
      onClose={props.onClose}
    />
  );
}

/** 承载冲突处理和流程选择；每个可见动作都必须由业务层显式命名。 */
export function AppActionDialog(props: AppActionDialogProps): JSX.Element {
  const { t } = useI18n();
  return (
    <AppDialog
      {...props}
      dismissAction={
        props.dismissAction === undefined ? { label: t("app.action.cancel") } : props.dismissAction
      }
    />
  );
}

/** 共享 Radix 壳层只负责可访问性、提交互斥和动作布局，不决定业务语义。 */
function AppDialog(props: AppActionDialogProps): JSX.Element {
  const { t } = useI18n();
  const submitting = props.submitting ?? false;
  const submitting_icon = props.submittingIcon ?? true;
  const title = props.title ?? t("app.action.confirm");

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
          className="fixed inset-0 z-(--ui-layer-overlay) bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <AlertDialogPrimitive.Content
          data-slot="alert-dialog-content"
          className="fixed top-1/2 left-1/2 z-(--ui-layer-overlay) grid w-full max-w-xs -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          onEscapeKeyDown={submitting ? preventDialogClose : undefined}
        >
          <div data-slot="alert-dialog-header" className="grid place-items-start gap-1.5 text-left">
            <AlertDialogPrimitive.Title
              data-slot="alert-dialog-title"
              className="font-heading text-base font-medium"
            >
              {title}
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description
              data-slot="alert-dialog-description"
              className="text-sm text-balance whitespace-pre-line text-left text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground"
            >
              {props.description}
            </AlertDialogPrimitive.Description>
          </div>
          <div
            data-slot="alert-dialog-footer"
            className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end"
          >
            {props.dismissAction === null ? null : (
              <Button variant="outline" size="sm" asChild>
                <AlertDialogPrimitive.Cancel
                  data-slot="alert-dialog-cancel"
                  disabled={submitting}
                  onClick={(event) => {
                    if (props.dismissAction?.onSelect === undefined) {
                      return;
                    }
                    event.preventDefault();
                    void props.dismissAction.onSelect();
                  }}
                >
                  {props.dismissAction?.label}
                </AlertDialogPrimitive.Cancel>
              </Button>
            )}
            {props.secondaryAction === undefined ? null : (
              <Button variant={props.secondaryAction.variant ?? "outline"} size="sm" asChild>
                <AlertDialogPrimitive.Action
                  data-slot="alert-dialog-secondary-action"
                  disabled={submitting}
                  onClick={(event) => {
                    event.preventDefault();
                    void props.secondaryAction?.onSelect();
                  }}
                >
                  {props.secondaryAction.label}
                </AlertDialogPrimitive.Action>
              </Button>
            )}
            <Button variant={props.primaryAction.variant ?? "default"} size="sm" asChild>
              <AlertDialogPrimitive.Action
                data-slot="alert-dialog-primary-action"
                disabled={submitting}
                onClick={(event) => {
                  event.preventDefault();
                  void props.primaryAction.onSelect();
                }}
              >
                {submitting ? (
                  <>
                    {submitting_icon ? <Spinner data-icon="inline-start" /> : null}
                    {props.submittingLabel ?? t("app.action.loading")}
                  </>
                ) : (
                  props.primaryAction.label
                )}
              </AlertDialogPrimitive.Action>
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
