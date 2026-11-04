import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { type JSX, useLayoutEffect, useRef, type ReactNode } from "react";

import { useI18n } from "@frontend/app/locale/locale-context";
import { cn } from "@frontend/shadcn/classnames";
import { Spinner } from "@frontend/shadcn/spinner";
import { AppButton } from "@frontend/widgets/app-button";
import {
  get_shortcut_aria_keys,
  is_dialog_primary_shortcut_event,
} from "@frontend/widgets/interactions/keyboard-shortcuts";
import { ShortcutKbd } from "@frontend/widgets/interactions/shortcut-kbd";
import { useConfirmDelay } from "@frontend/widgets/interactions/use-confirm-delay";

type AppDialogAction = {
  label: string;
  onSelect: () => void | Promise<void>;
  disabled?: boolean; // 动作自身的可用性独立于提交互斥
};

type AppDialogPrimaryAction = AppDialogAction & {
  delayed?: boolean; // 危险动作在开放确认前启用统一倒计时
};

type AppDialogActionPosition = "primary" | "secondary";

type AppDialogBaseProps = {
  open: boolean;
  hideTitle?: boolean | undefined; // 标题统一为「确认」，隐藏时用主操作为弹窗命名。
  description: ReactNode;
  details?: ReactNode; // 动作弹窗可在无障碍描述之外承载结构化业务详情
  onClose: () => void;
  submitting?: boolean | undefined;
  submittingAction?: AppDialogActionPosition; // 多动作弹窗由业务状态指定加载反馈归属
  submittingLabel?: string;
  submittingIcon?: boolean;
};

type AppConfirmDialogProps = Omit<
  AppDialogBaseProps,
  "details" | "submittingAction" | "submittingLabel" | "submittingIcon"
> & {
  onConfirm: () => void | Promise<void>;
  confirmDelay?: boolean; // 危险动作在开放确认前启用统一倒计时
  confirmDisabled?: boolean; // 弹窗打开期间仍受业务运行占用约束。
};

type AppActionDialogProps = AppDialogBaseProps & {
  contentClassName?: string;
  primaryAction: AppDialogPrimaryAction;
  secondaryAction?: AppDialogAction | undefined;
};

/** 固定承载取消/确认语义，危险动作沿用 `useConfirmDelay` 的统一倒计时。 */
export function AppConfirmDialog(props: AppConfirmDialogProps): JSX.Element {
  const { t } = useI18n();
  return (
    <AppActionDialog
      open={props.open}
      hideTitle={props.hideTitle}
      description={props.description}
      submitting={props.submitting}
      primaryAction={{
        label: t("app.action.confirm"),
        onSelect: props.onConfirm,
        disabled: props.confirmDisabled === true,
        delayed: props.confirmDelay === true,
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
  const title = props.hideTitle ? null : t("app.action.confirm");
  const has_header = title !== null || props.description != null;
  const submitting_action = submitting ? (props.submittingAction ?? "primary") : null;
  const remaining_seconds = useConfirmDelay(props.open, props.primaryAction.delayed === true);
  const primary_enabled =
    !submitting && remaining_seconds === 0 && props.primaryAction.disabled !== true;
  const popup_ref = useRef<HTMLDivElement>(null);
  const close_handled_ref = useRef(false); // 同一次关闭只向受控状态拥有者回流一次
  useLayoutEffect(() => {
    if (props.open) close_handled_ref.current = false;
  }, [props.open]);

  return (
    <AlertDialogPrimitive.Root
      data-slot="alert-dialog"
      open={props.open}
      onOpenChange={(next_open, details) => {
        if (!next_open) {
          if (submitting) details.cancel();
          else if (!close_handled_ref.current) {
            close_handled_ref.current = true; // 只有已受理的关闭才去重，提交期间被拦截的 Escape 不占用标记
            props.onClose();
          }
        }
      }}
    >
      <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal">
        <AlertDialogPrimitive.Backdrop
          data-slot="alert-dialog-overlay"
          className="[-webkit-app-region:no-drag] fixed inset-0 z-(--ui-layer-overlay) bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <AlertDialogPrimitive.Popup
          ref={popup_ref}
          // 默认会聚焦首个按钮「取消」，改为聚焦弹窗本身，回车才能直达主操作。
          initialFocus={popup_ref}
          data-slot="alert-dialog-content"
          onKeyDown={(event) => {
            if (
              primary_enabled &&
              is_dialog_primary_shortcut_event(event.nativeEvent, "submit", event.currentTarget)
            ) {
              event.preventDefault();
              void props.primaryAction.onSelect();
            }
          }}
          aria-label={title === null ? props.primaryAction.label : undefined}
          className={cn(
            "fixed top-1/2 left-1/2 z-(--ui-layer-overlay) flex max-h-[calc(100vh-32px)] w-[calc(100%-32px)] max-w-xs -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            props.contentClassName,
          )}
        >
          {has_header || props.details != null ? (
            <div className="min-h-0 overflow-y-auto">
              {has_header ? (
                <div
                  data-slot="alert-dialog-header"
                  className="grid place-items-start gap-1.5 text-left"
                >
                  {title === null ? null : (
                    <AlertDialogPrimitive.Title
                      data-slot="alert-dialog-title"
                      className="font-heading text-base font-medium"
                    >
                      {title}
                    </AlertDialogPrimitive.Title>
                  )}
                  {props.description == null ? null : (
                    <AlertDialogPrimitive.Description
                      render={<div />}
                      data-slot="alert-dialog-description"
                      className="w-full min-w-0 text-sm text-balance whitespace-pre-line text-left text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground"
                    >
                      {props.description}
                    </AlertDialogPrimitive.Description>
                  )}
                </div>
              ) : null}
              {props.details == null ? null : (
                <div data-slot="alert-dialog-details" className={has_header ? "mt-4" : undefined}>
                  {props.details}
                </div>
              )}
            </div>
          ) : null}
          <div
            data-slot="alert-dialog-footer"
            className="-mx-4 -mb-4 flex shrink-0 flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:flex-wrap sm:justify-end"
          >
            <AppButton
              variant="outline"
              size="sm"
              data-slot="alert-dialog-cancel"
              disabled={submitting}
              aria-keyshortcuts={get_shortcut_aria_keys("cancel")}
              onClick={(event) => {
                event.preventDefault();
                props.onClose();
              }}
            >
              {t("app.action.cancel")}
              <ShortcutKbd action="cancel" />
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
                {submitting_action === "secondary" ? (
                  <>
                    {submitting_icon ? <Spinner data-icon="inline-start" /> : null}
                    {props.submittingLabel ?? t("app.action.loading")}
                  </>
                ) : (
                  props.secondaryAction.label
                )}
              </AppButton>
            )}
            <AppButton
              size="sm"
              data-slot="alert-dialog-primary-action"
              disabled={!primary_enabled}
              aria-keyshortcuts={get_shortcut_aria_keys("submit")}
              onClick={(event) => {
                event.preventDefault();
                void props.primaryAction.onSelect();
              }}
            >
              {submitting_action === "primary" ? (
                <>
                  {submitting_icon ? <Spinner data-icon="inline-start" /> : null}
                  {props.submittingLabel ?? t("app.action.loading")}
                </>
              ) : remaining_seconds > 0 ? (
                `${remaining_seconds}s`
              ) : (
                props.primaryAction.label
              )}
              <ShortcutKbd action="submit" />
            </AppButton>
          </div>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
