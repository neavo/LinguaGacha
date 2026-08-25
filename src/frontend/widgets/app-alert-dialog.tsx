import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { useLayoutEffect, useState } from "react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import { Button } from "@frontend/shadcn/button";
import { Spinner } from "@frontend/shadcn/spinner";

type AppDialogAction = {
  label: string;
  onSelect: () => void | Promise<void>;
  variant?: "default" | "destructive" | "outline";
  disabled?: boolean; // 动作自身的可用性独立于提交互斥
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
  confirmDelay?: boolean; // 危险动作在开放确认前启用统一倒计时
};

type AppActionDialogProps = AppDialogBaseProps & {
  primaryAction: AppDialogAction;
  secondaryAction?: AppDialogAction;
  dismissAction?: AppDialogDismissAction | null;
};

type ClosableEvent = {
  preventDefault: () => void;
};

// 延迟确认采用统一时长，业务层只判断动作是否需要保护。
const CONFIRM_DELAY_SECONDS = 3;

/** 提交期间禁止通过键盘或外部事件关闭模态窗。 */
function preventDialogClose(event: ClosableEvent): void {
  event.preventDefault();
}

/** 固定承载取消/确认语义，并在危险动作需要时统一延迟确认。 */
export function AppConfirmDialog(props: AppConfirmDialogProps): JSX.Element {
  const { t } = useI18n();
  const [remaining_seconds, set_remaining_seconds] = useState(0); // 当前弹窗的瞬时倒计时，不进入业务状态

  useLayoutEffect(() => {
    if (!props.open || !props.confirmDelay) {
      set_remaining_seconds(0);
      return;
    }

    // 在弹窗绘制前锁定确认按钮，避免打开瞬间短暂暴露可提交状态。
    set_remaining_seconds(CONFIRM_DELAY_SECONDS);
    // 每秒递减，归零后立即停止，避免确认框关闭后继续持有定时器。
    const timer_id = window.setInterval(() => {
      set_remaining_seconds((previous_seconds) => {
        if (previous_seconds <= 1) {
          window.clearInterval(timer_id);
          return 0;
        }

        return previous_seconds - 1;
      });
    }, 1_000);

    return () => window.clearInterval(timer_id);
  }, [props.confirmDelay, props.open]);

  const confirm_is_delayed = props.open && remaining_seconds > 0; // 同时驱动可见秒数与动作禁用，避免两套状态漂移
  return (
    <AppDialog
      open={props.open}
      title={props.title}
      description={props.description}
      submitting={props.submitting}
      primaryAction={{
        label: confirm_is_delayed ? `${remaining_seconds}s` : t("app.action.confirm"),
        onSelect: props.onConfirm,
        disabled: confirm_is_delayed,
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
                  disabled={submitting || props.secondaryAction.disabled}
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
                disabled={submitting || props.primaryAction.disabled}
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
