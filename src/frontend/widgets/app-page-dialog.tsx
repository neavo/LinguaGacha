import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { useI18n } from "@frontend/app/locale/locale-provider";
import { cn } from "@frontend/shadcn/classnames";
import { AppButton } from "@frontend/widgets/app-button";

type AppPageDialogSize = "sm" | "md" | "lg" | "xl";
type AppPageDialogDismissBehavior = "default" | "escape-only" | "blocked";

type AppPageDialogProps = {
  open: boolean;
  title: string;
  size?: AppPageDialogSize;
  onClose: () => void | Promise<void>;
  dismissBehavior?: AppPageDialogDismissBehavior;
  footer?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
};

const SIZE_CLASS_NAME_BY_VALUE: Record<AppPageDialogSize, string> = {
  sm: "sm:max-w-[560px]",
  md: "sm:max-w-[720px]",
  lg: "sm:max-w-[960px]",
  xl: "sm:max-w-[1120px]",
};

const DEFAULT_HEIGHT_CLASS_NAME_BY_SIZE: Record<AppPageDialogSize, string> = {
  sm: "",
  md: "",
  lg: "h-[640px]",
  xl: "h-[640px]",
};

/**
 * 页面级内容对话框：统一尺寸、默认页脚，并显式区分默认、仅 Esc 和不可取消流程。
 */
export function AppPageDialog(props: AppPageDialogProps): JSX.Element {
  const { t } = useI18n();
  const size = props.size ?? "md";
  const dismiss_behavior = props.dismissBehavior ?? "default";
  const blocks_escape = dismiss_behavior === "blocked";
  const blocks_pointer = dismiss_behavior !== "default";
  const footer_content =
    props.footer === undefined ? (
      <AppButton
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          void props.onClose();
        }}
      >
        {t("app.action.close")}
      </AppButton>
    ) : (
      props.footer
    );

  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      open={props.open}
      onOpenChange={(next_open, details) => {
        if (!next_open) {
          const blocked = blocks_escape || (blocks_pointer && details.reason === "outside-press");
          if (blocked) details.cancel();
          else void props.onClose();
        }
      }}
    >
      <DialogPrimitive.Portal data-slot="dialog-portal">
        <DialogPrimitive.Backdrop
          data-slot="dialog-overlay"
          className="fixed inset-0 isolate z-(--ui-layer-overlay) bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cn(
            "fixed top-1/2 left-1/2 z-(--ui-layer-overlay) flex max-h-[calc(100vh-48px)] w-[calc(100vw-48px)] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-xl bg-popover p-0 text-sm text-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            SIZE_CLASS_NAME_BY_VALUE[size],
            DEFAULT_HEIGHT_CLASS_NAME_BY_SIZE[size],
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

          {footer_content === null ? null : (
            <div
              className={cn(
                "flex flex-col-reverse gap-2 border-t bg-muted/50 px-6 py-4 sm:flex-row sm:justify-end",
                props.footerClassName,
              )}
            >
              {footer_content}
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
