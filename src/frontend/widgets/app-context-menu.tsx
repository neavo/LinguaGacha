import type { ComponentProps } from "react";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";

import { cn } from "@frontend/shadcn/classnames";

/** Radix 菜单与窗口边缘保留的最小安全间距，两个菜单入口共用同一视觉约定。 */
const MENU_VIEWPORT_PADDING = 8;

// 本文件只为 Radix 右键菜单原语补充应用级 data-slot 与视觉约定，不持有业务状态。
function AppContextMenu(props: ComponentProps<typeof ContextMenuPrimitive.Root>): JSX.Element {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function AppContextMenuTrigger({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Trigger>): JSX.Element {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={cn("select-none", className)}
      {...props}
    />
  );
}

function AppContextMenuGroup(
  props: ComponentProps<typeof ContextMenuPrimitive.Group>,
): JSX.Element {
  return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />;
}

function AppContextMenuPortal(
  props: ComponentProps<typeof ContextMenuPrimitive.Portal>,
): JSX.Element {
  return <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />;
}

function AppContextMenuSub(props: ComponentProps<typeof ContextMenuPrimitive.Sub>): JSX.Element {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />;
}

function AppContextMenuRadioGroup(
  props: ComponentProps<typeof ContextMenuPrimitive.RadioGroup>,
): JSX.Element {
  return <ContextMenuPrimitive.RadioGroup data-slot="context-menu-radio-group" {...props} />;
}

function AppContextMenuContent({
  className,
  collisionPadding = MENU_VIEWPORT_PADDING,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left";
}): JSX.Element {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        collisionPadding={collisionPadding}
        className={cn(
          "z-(--ui-layer-popover) max-h-(--radix-context-menu-content-available-height) min-w-36 origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          "w-max min-w-36 text-[13px]",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

function AppContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}): JSX.Element {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/context-menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus:*:[svg]:text-accent-foreground data-[variant=destructive]:*:[svg]:text-destructive",
        "text-[13px]",
        className,
      )}
      {...props}
    />
  );
}

function AppContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}): JSX.Element {
  return (
    <ContextMenuPrimitive.SubTrigger
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
    </ContextMenuPrimitive.SubTrigger>
  );
}

function AppContextMenuSubContent({
  className,
  collisionPadding = MENU_VIEWPORT_PADDING,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.SubContent>): JSX.Element {
  return (
    <ContextMenuPrimitive.SubContent
      data-slot="context-menu-sub-content"
      collisionPadding={collisionPadding}
      className={cn(
        "z-(--ui-layer-popover) min-w-32 origin-(--radix-context-menu-content-transform-origin) overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        "text-[13px] ring-1 ring-foreground/10",
        className,
      )}
      {...props}
    />
  );
}

function AppContextMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.CheckboxItem> & {
  inset?: boolean;
}): JSX.Element {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "text-[13px]",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
}

function AppContextMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.RadioItem> & {
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
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  );
}

function AppContextMenuLabel({
  className,
  inset,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Label> & {
  inset?: boolean;
}): JSX.Element {
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn(
        "px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
        "text-[13px]",
        className,
      )}
      {...props}
    />
  );
}

function AppContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Separator>): JSX.Element {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function AppContextMenuShortcut({ className, ...props }: ComponentProps<"span">): JSX.Element {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-focus/context-menu-item:text-accent-foreground",
        "text-[13px]",
        className,
      )}
      {...props}
    />
  );
}

export {
  AppContextMenu,
  AppContextMenuCheckboxItem,
  AppContextMenuContent,
  AppContextMenuGroup,
  AppContextMenuItem,
  AppContextMenuLabel,
  AppContextMenuPortal,
  AppContextMenuRadioGroup,
  AppContextMenuRadioItem,
  AppContextMenuSeparator,
  AppContextMenuShortcut,
  AppContextMenuSub,
  AppContextMenuSubContent,
  AppContextMenuSubTrigger,
  AppContextMenuTrigger,
};
