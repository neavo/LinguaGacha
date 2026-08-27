"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@frontend/shadcn/classnames";

const tooltipContentClassName =
  "relative box-border flex w-max min-w-0 max-w-[min(320px,var(--available-width))] items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background origin-(--transform-origin) whitespace-normal break-words [overflow-wrap:anywhere] has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";
const tooltipArrowClassName =
  "relative block h-1.5 w-3 overflow-clip data-[side=bottom]:top-[-6px] data-[side=left]:right-[-9px] data-[side=left]:rotate-90 data-[side=right]:left-[-9px] data-[side=right]:-rotate-90 data-[side=top]:bottom-[-6px] data-[side=top]:rotate-180 before:absolute before:bottom-0 before:left-1/2 before:h-[calc(6px*sqrt(2))] before:w-[calc(6px*sqrt(2))] before:bg-foreground before:content-[''] before:[transform:translate(-50%,50%)_rotate(45deg)]";
const TOOLTIP_WINDOW_DEACTIVATED = "linguagacha:tooltip-window-deactivated";

type TooltipWindowContext = { suppressed: React.RefObject<boolean>; revision: number };
const TooltipWindowContext = React.createContext<TooltipWindowContext | null>(null);

function TooltipProvider({
  delay = 0,
  children,
  ...props
}: TooltipPrimitive.Provider.Props): JSX.Element {
  const suppressed = React.useRef(false);
  const [revision, set_revision] = React.useState(0);

  React.useEffect(() => {
    // 窗口或页面可见性切换时关闭当前提示，并让触发器重挂载，避免静止指针再次打开提示。
    const suppress = (): void => {
      suppressed.current = true;
      set_revision((current) => current + 1);
      document.dispatchEvent(new Event(TOOLTIP_WINDOW_DEACTIVATED));
    };
    const release = (): void => {
      suppressed.current = false;
    };

    window.addEventListener("blur", suppress);
    window.addEventListener("focus", suppress);
    window.addEventListener("pointermove", release, true);
    window.addEventListener("pointerdown", release, true);
    window.addEventListener("keydown", release, true);
    document.addEventListener("visibilitychange", suppress);

    return () => {
      window.removeEventListener("blur", suppress);
      window.removeEventListener("focus", suppress);
      window.removeEventListener("pointermove", release, true);
      window.removeEventListener("pointerdown", release, true);
      window.removeEventListener("keydown", release, true);
      document.removeEventListener("visibilitychange", suppress);
    };
  }, []);

  return (
    <TooltipWindowContext.Provider value={{ suppressed, revision }}>
      <TooltipPrimitive.Provider delay={delay} {...props}>
        {children}
      </TooltipPrimitive.Provider>
    </TooltipWindowContext.Provider>
  );
}

function Tooltip({ actionsRef, onOpenChange, ...props }: TooltipPrimitive.Root.Props): JSX.Element {
  const window_context = React.useContext(TooltipWindowContext);
  const local_actions = React.useRef<TooltipPrimitive.Root.Actions | null>(null);
  React.useEffect(() => {
    const close = (): void => local_actions.current?.close();
    document.addEventListener(TOOLTIP_WINDOW_DEACTIVATED, close);
    return () => document.removeEventListener(TOOLTIP_WINDOW_DEACTIVATED, close);
  }, []);

  return (
    <TooltipPrimitive.Root
      {...props}
      actionsRef={actionsRef ?? local_actions}
      onOpenChange={(open, details) => {
        if (open && window_context?.suppressed.current) {
          details.cancel();
          return;
        }
        onOpenChange?.(open, details);
      }}
    />
  );
}

function TooltipTrigger({ children, ...props }: TooltipPrimitive.Trigger.Props): JSX.Element {
  const window_context = React.useContext(TooltipWindowContext);
  return (
    <TooltipPrimitive.Trigger key={window_context?.revision} data-slot="tooltip-trigger" {...props}>
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
