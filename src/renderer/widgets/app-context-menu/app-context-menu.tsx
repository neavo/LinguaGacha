import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/shadcn/context-menu";

function AppContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuContent>): JSX.Element {
  return <ContextMenuContent className={cn("w-max min-w-36 text-[13px]", className)} {...props} />;
}

function AppContextMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuSubContent>): JSX.Element {
  return (
    <ContextMenuSubContent
      className={cn("text-[13px] ring-1 ring-foreground/10", className)}
      {...props}
    />
  );
}

function AppContextMenuItem({
  className,
  ...props
}: ComponentProps<typeof ContextMenuItem>): JSX.Element {
  return <ContextMenuItem className={cn("text-[13px]", className)} {...props} />;
}

function AppContextMenuCheckboxItem({
  className,
  ...props
}: ComponentProps<typeof ContextMenuCheckboxItem>): JSX.Element {
  return <ContextMenuCheckboxItem className={cn("text-[13px]", className)} {...props} />;
}

function AppContextMenuRadioItem({
  className,
  ...props
}: ComponentProps<typeof ContextMenuRadioItem>): JSX.Element {
  return <ContextMenuRadioItem className={cn("text-[13px]", className)} {...props} />;
}

function AppContextMenuSubTrigger({
  className,
  ...props
}: ComponentProps<typeof ContextMenuSubTrigger>): JSX.Element {
  return <ContextMenuSubTrigger className={cn("text-[13px]", className)} {...props} />;
}

function AppContextMenuLabel({
  className,
  ...props
}: ComponentProps<typeof ContextMenuLabel>): JSX.Element {
  return <ContextMenuLabel className={cn("text-[13px]", className)} {...props} />;
}

function AppContextMenuShortcut({
  className,
  ...props
}: ComponentProps<typeof ContextMenuShortcut>): JSX.Element {
  return <ContextMenuShortcut className={cn("text-[13px]", className)} {...props} />;
}

export {
  ContextMenu as AppContextMenu,
  ContextMenuGroup as AppContextMenuGroup,
  ContextMenuPortal as AppContextMenuPortal,
  ContextMenuRadioGroup as AppContextMenuRadioGroup,
  ContextMenuSeparator as AppContextMenuSeparator,
  ContextMenuSub as AppContextMenuSub,
  ContextMenuTrigger as AppContextMenuTrigger,
  AppContextMenuCheckboxItem,
  AppContextMenuContent,
  AppContextMenuItem,
  AppContextMenuLabel,
  AppContextMenuRadioItem,
  AppContextMenuShortcut,
  AppContextMenuSubContent,
  AppContextMenuSubTrigger,
};
