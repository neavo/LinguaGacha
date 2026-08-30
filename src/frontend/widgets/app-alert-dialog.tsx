import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import { Spinner } from "@frontend/shadcn/spinner";
import { AppButton } from "@frontend/widgets/app-button";

type AppDialogAction = {
  label: string;
  onSelect: () => void | Promise<void>;
  disabled?: boolean; // 动作自身的可用性独立于提交互斥
};

type AppDialogPrimaryAction = AppDialogAction & {
  destructive?: boolean;
};

type AppDialogBaseProps = {
  open: boolean;
  title?: string;
  description: string;
  details?: ReactNode; // 动作弹窗可在无障碍描述之外承载结构化业务详情
  onClose: () => void;
  submitting?: boolean;
  submittingLabel?: string;
  submittingIcon?: boolean;
};

type AppConfirmDialogProps = Omit<
  AppDialogBaseProps,
  "details" | "submittingLabel" | "submittingIcon"
> & {
  onConfirm: () => void | Promise<void>;
  confirmDelay?: boolean; // 危险动作在开放确认前启用统一倒计时
};

type AppActionDialogProps = AppDialogBaseProps & {
  primaryAction: AppDialogPrimaryAction;
  secondaryAction?: AppDialogAction;
};

// 延迟确认采用统一时长，业务层只判断动作是否需要保护。
const CONFIRM_DELAY_SECONDS = 3;

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
    <AppActionDialog
      open={props.open}
      title={props.title}
      description={props.description}
      submitting={props.submitting}
      primaryAction={{
        label: confirm_is_delayed ? `${remaining_seconds}s` : t("app.action.confirm"),
        onSelect: props.onConfirm,
        disabled: confirm_is_delayed,
      }}
      onClose={props.onClose}
    />
  );
}

/** 承载冲突处理和流程选择，并统一可访问性、提交互斥与动作布局。 */
export function AppActionDialog(props: AppActionDialogProps): JSX.Element {
  const { t } = useI18n();
  const submitting = props.submitting ?? false;
  const submitting_icon = props.submittingIcon ?? true;
  const title = props.title ?? t("app.action.confirm");
  const close_handled_ref = useRef(false); // 同一次关闭只向受控状态拥有者回流一次
  useLayoutEffect(() => {
    if (props.open) close_handled_ref.current = false;
  }, [props.open]);

  return (
    <AlertDialogPrimitive.Root
      data-slot="alert-dialog"
      open={props.open}
      onOpenChange={(next_open, details) => {
        if (!next_open && !close_handled_ref.current) {
          close_handled_ref.current = true;
          if (submitting) details.cancel();
          else props.onClose();
        }
      }}
    >
      <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal">
        <AlertDialogPrimitive.Backdrop
          data-slot="alert-dialog-overlay"
          className="fixed inset-0 z-(--ui-layer-overlay) bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <AlertDialogPrimitive.Popup
          data-slot="alert-dialog-content"
          className="fixed top-1/2 left-1/2 z-(--ui-layer-overlay) grid w-full max-w-xs -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
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
          {props.details === undefined ? null : (
            <div data-slot="alert-dialog-details">{props.details}</div>
          )}
          <div
            data-slot="alert-dialog-footer"
            className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end"
          >
            <AppButton
              variant="outline"
              size="sm"
              data-slot="alert-dialog-cancel"
              disabled={submitting}
              onClick={(event) => {
                event.preventDefault();
                props.onClose();
              }}
            >
              {t("app.action.cancel")}
            </AppButton>
            {props.secondaryAction === undefined ? null : (
              <AppButton
                variant="outline"
                size="sm"
                data-slot="alert-dialog-secondary-action"
                disabled={submitting || props.secondaryAction.disabled}
                onClick={(event) => {
                  event.preventDefault();
                  void props.secondaryAction?.onSelect();
                }}
              >
                {props.secondaryAction.label}
              </AppButton>
            )}
            <AppButton
              variant={props.primaryAction.destructive ? "destructive" : "default"}
              size="sm"
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
            </AppButton>
          </div>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
