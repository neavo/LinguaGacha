"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@frontend/shadcn/classnames";
import { useWindowDeactivation } from "@frontend/widgets/interactions/use-window-deactivation";

const tooltipContentClassName =
  "relative box-border flex w-max min-w-0 max-w-[min(320px,var(--available-width))] items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background origin-(--transform-origin) whitespace-normal break-words [overflow-wrap:anywhere] has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";
const tooltipArrowClassName =
  "relative block h-1.5 w-3 overflow-clip data-[side=bottom]:top-[-6px] data-[side=left]:right-[-9px] data-[side=left]:rotate-90 data-[side=right]:left-[-9px] data-[side=right]:-rotate-90 data-[side=top]:bottom-[-6px] data-[side=top]:rotate-180 before:absolute before:bottom-0 before:left-1/2 before:h-[calc(6px*sqrt(2))] before:w-[calc(6px*sqrt(2))] before:bg-foreground before:content-[''] before:[transform:translate(-50%,50%)_rotate(45deg)]";
const TooltipWindowContext = React.createContext(false);
const TooltipHandleContext = React.createContext<{
  handle: NonNullable<TooltipPrimitive.Root.Props["handle"]>;
  disabled: boolean;
} | null>(null);

/** 窗口失活后暂停提示，新的键盘或指针操作恢复交互。 */
function TooltipProvider({
  delay = 0,
  children,
  ...props
}: TooltipPrimitive.Provider.Props): JSX.Element {
  const [suppressed, set_suppressed] = React.useState(false);
  const pointer = React.useRef<{ x: number; y: number } | null>(null);
  useWindowDeactivation(() => set_suppressed(true));

  React.useEffect(() => {
    const release = (): void => {
      set_suppressed(false);
    };
    // 恢复窗口可能重复发送原位置的指针事件，坐标变化才重新启用悬停。
    const move = (event: PointerEvent): void => {
      const previous = pointer.current;
      pointer.current = { x: event.clientX, y: event.clientY };
      if (previous === null || previous.x !== event.clientX || previous.y !== event.clientY)
        release();
    };

    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerdown", release, true);
    window.addEventListener("keydown", release, true);

    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerdown", release, true);
      window.removeEventListener("keydown", release, true);
    };
  }, []);

  return (
    <TooltipWindowContext.Provider value={suppressed}>
      <TooltipPrimitive.Provider delay={delay} {...props}>
        {children}
      </TooltipPrimitive.Provider>
    </TooltipWindowContext.Provider>
  );
}

/** 共享 handle 保持触发器身份，并承接窗口关闭与悬停恢复。 */
function Tooltip({ disabled, handle, ...props }: TooltipPrimitive.Root.Props): JSX.Element {
  const suppressed = React.useContext(TooltipWindowContext);
  const [local_handle] = React.useState(() => TooltipPrimitive.createHandle());
  const tooltip_handle = handle ?? local_handle;
  useWindowDeactivation(() => tooltip_handle.close());

  return (
    <TooltipHandleContext.Provider value={{ handle: tooltip_handle, disabled: Boolean(disabled) }}>
      <TooltipPrimitive.Root {...props} handle={tooltip_handle} disabled={disabled || suppressed} />
    </TooltipHandleContext.Provider>
  );
}

/** 为同一触发器内的恢复移动补足悬停入口，保留消费方事件处理。 */
function TooltipTrigger({
  children,
  handle,
  id,
  disabled,
  onMouseMove,
  ...props
}: TooltipPrimitive.Trigger.Props): JSX.Element {
  const inherited = React.useContext(TooltipHandleContext);
  const suppressed = React.useContext(TooltipWindowContext);
  const generated_id = React.useId();
  const trigger_id = id ?? generated_id;
  const tooltip_handle = handle ?? inherited?.handle;
  const resume_hover = React.useRef(false);
  if (suppressed) resume_hover.current = true;
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      {...props}
      id={trigger_id}
      handle={tooltip_handle}
      disabled={disabled}
      onMouseMove={(event) => {
        onMouseMove?.(event);
        // 恢复后在同一触发器内移动可能没有 mouseenter，公开 handle 可恢复悬停且保留定位锚点。
        if (
          resume_hover.current &&
          !suppressed &&
          !disabled &&
          !inherited?.disabled &&
          !event.defaultPrevented &&
          event.target instanceof Element &&
          event.target.closest('[data-slot="tooltip-trigger"]') === event.currentTarget
        ) {
          resume_hover.current = false;
          tooltip_handle?.open(trigger_id);
        }
      }}
    >
      {children}
    </TooltipPrimitive.Trigger>
  );
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 0,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "side" | "sideOffset" | "align" | "alignOffset"
  >): JSX.Element {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        data-slot="tooltip-positioner"
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        collisionPadding={8}
        arrowPadding={8}
        className="isolate max-w-(--available-width) z-(--ui-layer-tooltip) [-webkit-app-region:no-drag]"
      >
        <TooltipPrimitive.Popup
          role="tooltip"
          data-slot="tooltip-content"
          className={cn(tooltipContentClassName, className)}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className={tooltipArrowClassName} />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

function tooltip_trigger_target(trigger: React.ReactElement): React.ReactElement {
  return <span className="inline-flex">{trigger}</span>;
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, tooltip_trigger_target };
