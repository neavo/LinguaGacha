import type { ReactNode } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { AppButton } from "@/widgets/app-button/app-button";
import { Dialog, DialogContent, DialogTitle } from "@/shadcn/dialog";

type AppPageDialogSize = "sm" | "md" | "lg" | "xl";
type AppPageDialogDismissBehavior = "default" | "blocked";

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

type ClosableEvent = {
  preventDefault: () => void;
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

function preventDialogClose(event: ClosableEvent): void {
  event.preventDefault();
}

export function AppPageDialog(props: AppPageDialogProps): JSX.Element {
  const { t } = useI18n();
  const dismiss_behavior = props.dismissBehavior ?? "default";
  const is_blocked = dismiss_behavior === "blocked";
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
    <Dialog
      open={props.open}
      onOpenChange={(next_open) => {
        if (!next_open && !is_blocked) {
          void props.onClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex max-h-[calc(100vh-48px)] w-[calc(100vw-48px)] max-w-[calc(100vw-48px)] flex-col gap-0 overflow-hidden p-0 text-foreground",
          SIZE_CLASS_NAME_BY_VALUE[props.size ?? "md"],
          DEFAULT_HEIGHT_CLASS_NAME_BY_SIZE[props.size ?? "md"],
          props.contentClassName,
        )}
        onEscapeKeyDown={is_blocked ? preventDialogClose : undefined}
        onPointerDownOutside={is_blocked ? preventDialogClose : undefined}
      >
        <DialogTitle className="sr-only">{props.title}</DialogTitle>

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
      </DialogContent>
    </Dialog>
  );
}
