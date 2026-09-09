import { useRef, type ComponentProps } from "react";
import { useWindowDeactivation } from "@frontend/widgets/interactions/use-window-deactivation";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";

import { cn } from "@frontend/shadcn/classnames";
import { Kbd } from "@frontend/shadcn/kbd";
import {
  APP_MENU_POSITIONER_CLASS_NAME,
  APP_MENU_SUBMENU_SIDE_OFFSET,
  APP_MENU_VIEWPORT_PADDING,
  should_keep_submenu_open,
} from "@frontend/widgets/app-menu";

// 与调用方共用 actionsRef，使窗口失焦关闭经过 Base UI 原有的状态通知入口。
function AppContextMenu({ actionsRef, ...props }: ContextMenuPrimitive.Root.Props): JSX.Element {
  const local_actions = useRef<ContextMenuPrimitive.Root.Actions | null>(null);
  const actions = actionsRef ?? local_actions;
  useWindowDeactivation(() => actions.current?.close());
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} actionsRef={actions} />;
}

function AppContextMenuTrigger({
  className,
  children,
  ...props
}: ContextMenuPrimitive.Trigger.Props): JSX.Element {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={cn("select-none", className)}
      {...props}
    >
      {children}
    </ContextMenuPrimitive.Trigger>
  );
}

function AppContextMenuGroup(props: ContextMenuPrimitive.Group.Props): JSX.Element {
  return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />;
}

function AppContextMenuSub({
  onOpenChange,
  ...props
}: ContextMenuPrimitive.SubmenuRoot.Props): JSX.Element {
  return (
    <ContextMenuPrimitive.SubmenuRoot
      data-slot="context-menu-sub"
      {...props}
      onOpenChange={(open, details) => {
        if (should_keep_submenu_open(open, details.reason)) {
          details.cancel();
          return;
        }
        onOpenChange?.(open, details);
      }}
    />
  );
}

function AppContextMenuRadioGroup(props: ContextMenuPrimitive.RadioGroup.Props): JSX.Element {
  return <ContextMenuPrimitive.RadioGroup data-slot="context-menu-radio-group" {...props} />;
}

function AppContextMenuContent({
  className,
  collisionPadding = APP_MENU_VIEWPORT_PADDING,
  side = "right",
  ...props
}: ContextMenuPrimitive.Popup.Props &
  Pick<ContextMenuPrimitive.Positioner.Props, "collisionPadding"> & {
    side?: "top" | "right" | "bottom" | "left";
  }): JSX.Element {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        className={APP_MENU_POSITIONER_CLASS_NAME}
        collisionPadding={collisionPadding}
        side={side}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "max-h-(--available-height) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            "w-max min-w-36 text-[13px]",
            className,
          )}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function AppContextMenuItem({
  className,
  inset,
  variant = "default",
  onClick,
  ...props
}: ContextMenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
}): JSX.Element {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus:*:[svg]:text-accent-foreground data-[variant=destructive]:*:[svg]:text-destructive",
        "text-[13px]",
        className,
      )}
      onClick={onClick}
      closeOnClick
      {...props}
    />
  );
}

function AppContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ContextMenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean;
}): JSX.Element {
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "text-[13px]",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </ContextMenuPrimitive.SubmenuTrigger>
  );
}

function AppContextMenuSubContent({
  className,
  ...props
}: ContextMenuPrimitive.Popup.Props): JSX.Element {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        className={APP_MENU_POSITIONER_CLASS_NAME}
        collisionPadding={APP_MENU_VIEWPORT_PADDING}
        sideOffset={APP_MENU_SUBMENU_SIDE_OFFSET}
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-sub-content"
          className={cn(
            "min-w-32 origin-(--transform-origin) overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            "text-[13px] ring-1 ring-foreground/10",
            className,
          )}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function AppContextMenuRadioItem({
  className,
  children,
  inset,
  closeOnClick = true,
  ...props
}: ContextMenuPrimitive.RadioItem.Props & {
  inset?: boolean;
}): JSX.Element {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "text-[13px]",
        className,
      )}
      {...props}
      closeOnClick={closeOnClick}
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.RadioItemIndicator>
          <CheckIcon />
        </ContextMenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  );
}

/** 菜单只拥有尾部布局，键帽语义与外观由 Kbd 统一维护。 */
function AppContextMenuShortcut({ className, ...props }: ComponentProps<typeof Kbd>): JSX.Element {
  return <Kbd className={cn("ml-auto shrink-0", className)} {...props} />;
}

export {
  AppContextMenu,
  AppContextMenuContent,
  AppContextMenuGroup,
  AppContextMenuItem,
  AppContextMenuRadioGroup,
  AppContextMenuRadioItem,
  AppContextMenuShortcut,
  AppContextMenuSub,
  AppContextMenuSubContent,
  AppContextMenuSubTrigger,
  AppContextMenuTrigger,
};
