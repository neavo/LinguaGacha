import { useRef, type JSX, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { useI18n } from "@frontend/app/locale/locale-context";
import { cn } from "@frontend/shadcn/classnames";
import { Spinner } from "@frontend/shadcn/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import {
  get_shortcut_aria_keys,
  is_dialog_primary_shortcut_event,
  type DialogShortcut,
} from "@frontend/widgets/interactions/keyboard-shortcuts";
import { ShortcutKbd } from "@frontend/widgets/interactions/shortcut-kbd";

type AppPageDialogSize = "sm" | "md" | "lg" | "xl" | "viewport";
type AppPageDialogDismissBehavior = "default" | "escape-only";

type AppPageDialogPrimaryAction = {
  label: string;
  shortcut: DialogShortcut; // 含多行输入时用 `save`，避免与换行争用回车
  onSelect: () => void | Promise<void>;
  disabled?: boolean;
  tooltip?: string; // 主操作有额外后果时的悬停说明
};

type AppPageDialogProps = {
  open: boolean;
  title: string;
  size?: AppPageDialogSize;
  onClose: () => void | Promise<void>;
  dismissBehavior?: AppPageDialogDismissBehavior; // `escape-only` 禁止点击遮罩关闭，保护编辑中的草稿
  submitting?: boolean; // 锁定关闭与主操作，并在主操作上显示进度
  primaryAction?: AppPageDialogPrimaryAction | undefined;
  footerStart?: ReactNode | undefined; // 主操作之外的页内工具，靠左排列
  closeLabel?: string | undefined; // 默认有主操作时为“取消”，否则为“关闭”
  children: ReactNode;
  contentClassName?: string;
  bodyClassName?: string;
};

/** 固定档位限制公共宽度，`viewport` 经 `cn` 覆盖公共宽度并随视口伸展。 */
const SIZE_CLASS_NAME_BY_VALUE: Record<AppPageDialogSize, string> = {
  sm: "sm:max-w-[560px]",
  md: "sm:max-w-[720px]",
  lg: "h-[640px] sm:max-w-[960px]",
  xl: "h-[640px] sm:max-w-[1120px]",
  viewport: "h-[80vh] w-[80vw]",
};

/**
 * 页面级内容对话框：统一尺寸、页脚与快捷键，提交期间锁定关闭和主操作。
 */
export function AppPageDialog(props: AppPageDialogProps): JSX.Element {
  const { t } = useI18n();
  const size = props.size ?? "md";
  const submitting = props.submitting ?? false;
  const primary_action = props.primaryAction;
  const primary_enabled =
    primary_action !== undefined && !submitting && primary_action.disabled !== true; // 按钮与按键共用执行权限，绑定提示始终保留
  const close_label =
    props.closeLabel ?? t(primary_action === undefined ? "app.action.close" : "app.action.cancel");
  const popup_ref = useRef<HTMLDivElement>(null);

  const primary_button =
    primary_action === undefined ? null : (
      <AppButton
        type="button"
        size="sm"
        disabled={!primary_enabled}
        aria-busy={submitting || undefined}
        aria-keyshortcuts={get_shortcut_aria_keys(primary_action.shortcut)}
        onClick={() => {
          void primary_action.onSelect();
        }}
      >
        {submitting ? <Spinner data-icon="inline-start" /> : null}
        {primary_action.label}
        <ShortcutKbd action={primary_action.shortcut} />
      </AppButton>
    );

  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      open={props.open}
      onOpenChange={(next_open, details) => {
        if (!next_open) {
          const blocked =
            submitting ||
            (props.dismissBehavior === "escape-only" && details.reason === "outside-press");
          if (blocked) details.cancel();
          else void props.onClose();
        }
      }}
    >
      <DialogPrimitive.Portal data-slot="dialog-portal">
        <DialogPrimitive.Backdrop
          data-slot="dialog-overlay"
          className="[-webkit-app-region:no-drag] fixed inset-0 isolate z-(--ui-layer-overlay) bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <DialogPrimitive.Popup
          ref={popup_ref}
          // 回车提交的弹窗聚焦自身，避免默认聚焦首个按钮后回车落到该按钮。已自动聚焦的输入框不受影响。
          initialFocus={primary_action?.shortcut === "submit" ? popup_ref : undefined}
          data-slot="dialog-content"
          onKeyDown={(event) => {
            if (
              primary_enabled &&
              is_dialog_primary_shortcut_event(
                event.nativeEvent,
                primary_action.shortcut,
                event.currentTarget,
              )
            ) {
              event.preventDefault();
              void primary_action.onSelect();
            }
          }}
          className={cn(
            "fixed top-1/2 left-1/2 z-(--ui-layer-overlay) flex max-h-[calc(100vh-48px)] w-[calc(100vw-48px)] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-xl bg-popover p-0 text-sm text-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            SIZE_CLASS_NAME_BY_VALUE[size],
            props.contentClassName,
          )}
        >
          <DialogPrimitive.Title
            data-slot="dialog-title"
            className="font-heading sr-only text-base leading-none font-medium"
          >
            {props.title}
          </DialogPrimitive.Title>

          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-auto px-6 py-6",
              props.bodyClassName,
            )}
          >
            {props.children}
          </div>

          <div
            className={cn(
              "flex flex-col-reverse gap-2 border-t bg-muted/50 px-6 py-4 sm:flex-row",
              props.footerStart === undefined ? "sm:justify-end" : "sm:justify-between",
            )}
          >
            {props.footerStart === undefined ? null : (
              <div className="flex flex-wrap items-center gap-2">{props.footerStart}</div>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <AppButton
                type="button"
                variant="outline"
                size="sm"
                disabled={submitting}
                aria-keyshortcuts={get_shortcut_aria_keys("cancel")}
                onClick={() => {
                  void props.onClose();
                }}
              >
                {close_label}
                <ShortcutKbd action="cancel" />
              </AppButton>
              {primary_action?.tooltip === undefined || primary_button === null ? (
                primary_button
              ) : (
                <Tooltip>
                  <TooltipTrigger render={primary_button} />
                  <TooltipContent>{primary_action.tooltip}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
