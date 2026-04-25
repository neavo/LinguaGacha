import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shadcn/dropdown-menu";

type AppDropdownMenuContentProps = ComponentProps<typeof DropdownMenuContent> & {
  matchTriggerWidth?: boolean;
};

function AppDropdownMenuContent({
  align = "center",
  className,
  matchTriggerWidth = true,
  ...props
}: AppDropdownMenuContentProps): JSX.Element {
  return (
    <DropdownMenuContent
      align={align}
      className={cn(
        "text-[13px]",
        matchTriggerWidth ? "min-w-(--radix-dropdown-menu-trigger-width) w-max" : "w-max min-w-max",
        className,
      )}
      {...props}
    />
  );
}

function AppDropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuSubContent>): JSX.Element {
  return <DropdownMenuSubContent className={cn("text-[13px]", className)} {...props} />;
}

function AppDropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuItem>): JSX.Element {
  return <DropdownMenuItem className={cn("text-[13px]", className)} {...props} />;
}

function AppDropdownMenuCheckboxItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuCheckboxItem>): JSX.Element {
  return <DropdownMenuCheckboxItem className={cn("text-[13px]", className)} {...props} />;
}

function AppDropdownMenuRadioItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuRadioItem>): JSX.Element {
  return <DropdownMenuRadioItem className={cn("text-[13px]", className)} {...props} />;
}

function AppDropdownMenuSubTrigger({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuSubTrigger>): JSX.Element {
  return <DropdownMenuSubTrigger className={cn("text-[13px]", className)} {...props} />;
}

function AppDropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuLabel>): JSX.Element {
  return <DropdownMenuLabel className={cn("text-[13px]", className)} {...props} />;
}

function AppDropdownMenuShortcut({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuShortcut>): JSX.Element {
  return <DropdownMenuShortcut className={cn("text-[13px]", className)} {...props} />;
}

export {
  DropdownMenu as AppDropdownMenu,
  DropdownMenuGroup as AppDropdownMenuGroup,
  DropdownMenuPortal as AppDropdownMenuPortal,
  DropdownMenuRadioGroup as AppDropdownMenuRadioGroup,
  DropdownMenuSeparator as AppDropdownMenuSeparator,
  DropdownMenuSub as AppDropdownMenuSub,
  DropdownMenuTrigger as AppDropdownMenuTrigger,
  AppDropdownMenuCheckboxItem,
  AppDropdownMenuContent,
  AppDropdownMenuItem,
  AppDropdownMenuLabel,
  AppDropdownMenuRadioItem,
  AppDropdownMenuShortcut,
  AppDropdownMenuSubContent,
  AppDropdownMenuSubTrigger,
};
