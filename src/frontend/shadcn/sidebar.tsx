import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@frontend/shadcn/classnames";
import { Separator } from "@frontend/shadcn/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { type SidebarContextProps, SidebarContext, useSidebar } from "./sidebar-context";

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_ICON = "3rem";
// 占位与实体共用宽度动效，避免工作区边界在折叠过程中错位。
const SIDEBAR_TRANSITION =
  "transition-[width] duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";
// 按钮只负责交互状态，行高、图标列与文字布局由应用侧栏统一定义。
const SIDEBAR_BUTTON_INTERACTION =
  "outline-hidden focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-sidebar-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

/** 共享展开状态与切换动作；应用根负责持久化，控件只通知状态变化。 */
function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [_open, _setOpen] = React.useState(defaultOpen); // 侧边栏内部状态；外部控制时使用 openProp 和 setOpenProp
  const open = openProp ?? _open;
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value;
      if (setOpenProp) {
        setOpenProp(openState);
      } else {
        _setOpen(openState);
      }
    },
    [setOpenProp, open],
  );

  // 所有交互经同一入口提交，受控模式由宿主确认新状态。
  const toggleSidebar = React.useCallback(() => {
    return setOpen((open) => !open);
  }, [setOpen]);

  const state = open ? "expanded" : "collapsed"; // 暴露 data-state 方便 Tailwind 按展开或折叠状态设置样式

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      toggleSidebar,
    }),
    [state, open, setOpen, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        className={cn("flex min-h-svh w-full", className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

/** 固定在左侧的导航与工作区占位同步收缩，折叠后保留图标入口。 */
function Sidebar({ className, children, ...props }: React.ComponentProps<"div">) {
  const { state } = useSidebar();

  return (
    <div
      className="group text-sidebar-foreground"
      data-state={state}
      data-collapsible={state === "collapsed" ? "icon" : ""}
      data-slot="sidebar"
    >
      {/* 桌面端侧边栏占位间距由这里处理 */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "relative w-(--sidebar-width) group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
          SIDEBAR_TRANSITION,
        )}
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "fixed inset-y-0 left-0 z-10 flex h-svh w-(--sidebar-width) group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
          SIDEBAR_TRANSITION,
          className,
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="flex size-full flex-col bg-sidebar"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** 工作区填满侧栏占位之外的剩余空间。 */
function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn("relative flex w-full flex-1 flex-col bg-background", className)}
      {...props}
    />
  );
}

/** 将全局操作放在导航滚动区之外。 */
function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  );
}

/** 使用统一分隔线标识导航分组边界。 */
function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn("mx-2 w-auto bg-sidebar-border", className)}
      {...props}
    />
  );
}

/** 两种侧栏状态均允许导航内容独立滚动。 */
function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn("no-scrollbar flex min-h-0 flex-1 flex-col gap-0 overflow-auto", className)}
      {...props}
    />
  );
}

/** 为同组导航项提供布局容器。 */
function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  );
}

/** 将分组内容约束在侧栏可用宽度内。 */
function SidebarGroupContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  );
}

/** 主导航与子导航共用列表结构，层级缩进由调用方提供。 */
function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-0", className)}
      {...props}
    />
  );
}

/** 容纳导航按钮及其可选的子列表。 */
function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("relative", className)}
      {...props}
    />
  );
}

/** 统一导航按钮的交互状态，并在折叠时展示可选提示。 */
function SidebarMenuButton({
  isActive = false,
  tooltip,
  className,
  children,
  render,
  ...props
}: useRender.ComponentProps<"button"> & {
  isActive?: boolean;
  tooltip?: string;
}) {
  const { state } = useSidebar();
  const button = useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        "data-slot": "sidebar-menu-button",
        "data-sidebar": "menu-button",
        "data-active": isActive,
        className: cn(SIDEBAR_BUTTON_INTERACTION, className),
        children,
      } as React.ComponentProps<"button">,
      props,
    ),
    render,
    state: { slot: "sidebar-menu-button", sidebar: "menu-button", active: isActive },
  });

  if (!tooltip) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="right" align="center" hidden={state !== "collapsed"}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
};
